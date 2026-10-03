-- =============================================================
-- SISTEMA INTELIGENTE DE PARQUEO
-- Universidad Mariano Galvez de Guatemala - Ingenieria en Sistemas
-- Proyecto Integrador - Sexto Semestre Seccion A
--
-- Motor: SQLite 3
-- Uso:   sqlite3 parqueo.db < esquema_parqueo.sql
-- =============================================================

-- SQLite NO valida llaves foraneas por defecto. Hay que activarlo
-- en CADA conexion (en Node: db.pragma('foreign_keys = ON')).
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;   -- mejor concurrencia lectura/escritura


-- =============================================================
-- 1. CATALOGOS
-- =============================================================

-- Tipos de VEHICULO: lo que el usuario escribe en REGISTRAR(tipo, placa)
CREATE TABLE tipo_vehiculo (
    id      INTEGER PRIMARY KEY,
    codigo  TEXT NOT NULL UNIQUE,   -- token del lenguaje formal: 'compacto'
    nombre  TEXT NOT NULL
);

-- Tipos de ESPACIO: los 5 del enunciado.
-- requiere_reserva = 1 significa que solo se asigna a placas con reserva vigente.
CREATE TABLE tipo_espacio (
    id                INTEGER PRIMARY KEY,
    codigo            TEXT    NOT NULL UNIQUE,
    nombre            TEXT    NOT NULL,
    requiere_reserva  INTEGER NOT NULL DEFAULT 0
                      CHECK (requiere_reserva IN (0, 1))
);

-- Que tipo de vehiculo puede entrar en que tipo de espacio.
-- prioridad 1 = espacio ideal, 2 = alternativa aceptable, 3 = ultimo recurso.
-- Esta tabla es la que convierte la asignacion automatica en UNA consulta.
CREATE TABLE compatibilidad (
    tipo_vehiculo_id INTEGER NOT NULL REFERENCES tipo_vehiculo(id) ON DELETE CASCADE,
    tipo_espacio_id  INTEGER NOT NULL REFERENCES tipo_espacio(id)  ON DELETE CASCADE,
    prioridad        INTEGER NOT NULL DEFAULT 1 CHECK (prioridad BETWEEN 1 AND 9),
    PRIMARY KEY (tipo_vehiculo_id, tipo_espacio_id)
);


-- =============================================================
-- 2. ESPACIOS FISICOS DE LA MAQUETA
-- =============================================================

-- 'estado' esta duplicado a proposito (el historico real vive en 'ocupacion').
-- Se consulta muchas veces por segundo para refrescar los LEDs, por eso
-- se guarda desnormalizado aqui. Decision de diseno consciente.
--
-- pin_sensor  = pin digital del Arduino Mega donde va el FC-51 de ese espacio
-- indice_led  = posicion del LED en la tira WS2812B (0..9)
CREATE TABLE espacio (
    id               INTEGER PRIMARY KEY,
    codigo           TEXT    NOT NULL UNIQUE,   -- 'E01'
    tipo_espacio_id  INTEGER NOT NULL REFERENCES tipo_espacio(id),

    estado           TEXT    NOT NULL DEFAULT 'LIBRE'
                     CHECK (estado IN ('LIBRE','ASIGNADO','OCUPADO',
                                       'AUTORIZADO','ALARMA','FUERA_SERVICIO')),

    pin_sensor       INTEGER NOT NULL UNIQUE,
    indice_led       INTEGER NOT NULL UNIQUE,

    -- ultima lectura CRUDA del sensor (0 = vacio, 1 = detecta vehiculo).
    -- Comparar esto contra 'estado' es lo que dispara la alarma.
    sensor_ocupado   INTEGER NOT NULL DEFAULT 0 CHECK (sensor_ocupado IN (0,1)),

    actualizado_en   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX ix_espacio_estado ON espacio(estado);
CREATE INDEX ix_espacio_tipo   ON espacio(tipo_espacio_id);


-- =============================================================
-- 3. VEHICULOS Y RESERVAS
-- =============================================================

-- El vehiculo es una entidad permanente. Sus entradas y salidas
-- son eventos y viven en 'ocupacion'. Por eso la placa es UNIQUE:
-- REGISTRAR() con una placa ya existente reutiliza el registro.
CREATE TABLE vehiculo (
    id                INTEGER PRIMARY KEY,
    placa             TEXT    NOT NULL UNIQUE,
    tipo_vehiculo_id  INTEGER NOT NULL REFERENCES tipo_vehiculo(id),
    registrado_en     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),

    -- Formato de placa de Guatemala: P123ABC (letra + 3 digitos + 3 letras).
    -- Debe coincidir con la expresion regular del analizador lexico.
    CHECK (placa GLOB '[A-Z][0-9][0-9][0-9][A-Z][A-Z][A-Z]')
);

-- Un espacio 'reservado' solo se le asigna a la placa que lo tenga apartado.
CREATE TABLE reserva (
    id          INTEGER PRIMARY KEY,
    espacio_id  INTEGER NOT NULL REFERENCES espacio(id) ON DELETE CASCADE,
    placa       TEXT    NOT NULL,
    activa      INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0,1)),
    creada_en   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Indice UNIQUE PARCIAL: un espacio no puede tener dos reservas activas,
-- pero si puede tener muchas reservas historicas ya inactivas.
CREATE UNIQUE INDEX ux_reserva_espacio_activa
    ON reserva(espacio_id) WHERE activa = 1;


-- =============================================================
-- 4. OCUPACIONES (el historico y el ciclo de vida del automata)
-- =============================================================

-- Una fila = un ciclo completo ASIGNADO -> OCUPADO -> AUTORIZADO -> FINALIZADA.
-- Las 4 columnas de fecha son la traza del automata: sirven para el
-- reporte de tiempos y para demostrar que el orden de comandos se respeto.
CREATE TABLE ocupacion (
    id              INTEGER PRIMARY KEY,
    vehiculo_id     INTEGER NOT NULL REFERENCES vehiculo(id),
    espacio_id      INTEGER NOT NULL REFERENCES espacio(id),

    estado          TEXT NOT NULL DEFAULT 'ASIGNADO'
                    CHECK (estado IN ('ASIGNADO','OCUPADO','AUTORIZADO',
                                      'FINALIZADA','CANCELADA')),

    asignado_en     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    llegada_en      TEXT,          -- se llena con LLEGADA(placa)
    autorizado_en   TEXT,          -- se llena con AUTORIZAR_SALIDA(placa)
    salida_en       TEXT,          -- se llena con SALIDA(placa)

    -- 1 si el vehiculo se fue sin autorizacion (hubo alarma).
    -- Por eso NO exigimos autorizado_en para poder cerrar la ocupacion.
    salida_forzada  INTEGER NOT NULL DEFAULT 0 CHECK (salida_forzada IN (0,1)),

    -- Coherencia temporal: no se puede llegar antes de que te asignen.
    CHECK (llegada_en    IS NULL OR llegada_en    >= asignado_en),
    CHECK (autorizado_en IS NULL OR llegada_en    IS NOT NULL),
    CHECK (salida_en     IS NULL OR llegada_en    IS NOT NULL)
);

-- Reglas de oro del sistema, garantizadas por la BD y no solo por el codigo:
--   * un espacio no puede tener dos ocupaciones vivas
--   * un vehiculo no puede estar en dos espacios a la vez
CREATE UNIQUE INDEX ux_ocupacion_espacio_viva
    ON ocupacion(espacio_id)
    WHERE estado IN ('ASIGNADO','OCUPADO','AUTORIZADO');

CREATE UNIQUE INDEX ux_ocupacion_vehiculo_viva
    ON ocupacion(vehiculo_id)
    WHERE estado IN ('ASIGNADO','OCUPADO','AUTORIZADO');

CREATE INDEX ix_ocupacion_espacio ON ocupacion(espacio_id);
CREATE INDEX ix_ocupacion_estado  ON ocupacion(estado);


-- =============================================================
-- 5. ALARMAS
-- =============================================================

CREATE TABLE alarma (
    id            INTEGER PRIMARY KEY,
    ocupacion_id  INTEGER REFERENCES ocupacion(id),  -- NULL si nadie estaba asignado
    espacio_id    INTEGER NOT NULL REFERENCES espacio(id),

    motivo        TEXT NOT NULL DEFAULT 'SALIDA_NO_AUTORIZADA'
                  CHECK (motivo IN ('SALIDA_NO_AUTORIZADA',
                                    'MOVIMIENTO_NO_AUTORIZADO',
                                    'OCUPACION_NO_REGISTRADA',
                                    'MANUAL')),

    iniciada_en   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    apagada_en    TEXT,                              -- APAGAR_ALARMA(placa)
    apagada_por   TEXT
);

-- Un espacio no puede tener dos alarmas sonando al mismo tiempo.
CREATE UNIQUE INDEX ux_alarma_espacio_activa
    ON alarma(espacio_id) WHERE apagada_en IS NULL;


-- =============================================================
-- 6. BITACORA (auditoria del interprete y del hardware)
-- =============================================================

-- Aqui cae TODO: cada comando que pasa por el interprete, con su
-- resultado y sus errores lexicos / sintacticos / semanticos.
-- Esta tabla es la evidencia que se muestra en la defensa del proyecto.
CREATE TABLE bitacora (
    id           INTEGER PRIMARY KEY,
    origen       TEXT NOT NULL
                 CHECK (origen IN ('INTERPRETE','SENSOR','SISTEMA')),

    comando      TEXT,        -- texto crudo: 'REGISTRAR(compacto,P123ABC);'

    resultado    TEXT NOT NULL
                 CHECK (resultado IN ('OK','ERROR_LEXICO','ERROR_SINTACTICO',
                                      'ERROR_SEMANTICO','ERROR_HARDWARE')),

    mensaje      TEXT,        -- descripcion del error o de la accion
    linea        INTEGER,     -- posicion del error en el codigo fuente
    columna      INTEGER,

    espacio_id   INTEGER REFERENCES espacio(id),
    vehiculo_id  INTEGER REFERENCES vehiculo(id),
    creado_en    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX ix_bitacora_fecha     ON bitacora(creado_en);
CREATE INDEX ix_bitacora_resultado ON bitacora(resultado);


-- =============================================================
-- 7. VISTAS
-- =============================================================

-- Esta vista ES la respuesta del comando CONSULTAR() y tambien
-- lo que alimenta el mapa del parqueo en React.
CREATE VIEW v_estado_parqueo AS
SELECT
    e.id                AS espacio_id,
    e.codigo            AS espacio,
    te.codigo           AS tipo_espacio,
    e.estado,
    e.indice_led,
    e.sensor_ocupado,
    v.placa,
    tv.codigo           AS tipo_vehiculo,
    o.id                AS ocupacion_id,
    o.llegada_en,
    o.autorizado_en,
    CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END AS en_alarma
FROM espacio e
JOIN tipo_espacio te ON te.id = e.tipo_espacio_id
LEFT JOIN ocupacion o
       ON o.espacio_id = e.id
      AND o.estado IN ('ASIGNADO','OCUPADO','AUTORIZADO')
LEFT JOIN vehiculo v      ON v.id  = o.vehiculo_id
LEFT JOIN tipo_vehiculo tv ON tv.id = v.tipo_vehiculo_id
LEFT JOIN alarma a
       ON a.espacio_id = e.id
      AND a.apagada_en IS NULL;

-- Resumen por tipo, util para el panel superior de la interfaz.
CREATE VIEW v_disponibilidad AS
SELECT
    te.codigo AS tipo_espacio,
    COUNT(*)  AS total,
    SUM(CASE WHEN e.estado = 'LIBRE' THEN 1 ELSE 0 END) AS libres
FROM espacio e
JOIN tipo_espacio te ON te.id = e.tipo_espacio_id
GROUP BY te.codigo;


-- =============================================================
-- 8. DATOS SEMILLA
-- =============================================================

INSERT INTO tipo_vehiculo (id, codigo, nombre) VALUES
    (1, 'compacto', 'Vehiculo compacto'),
    (2, 'grande',   'Vehiculo grande'),
    (3, 'moto',     'Motocicleta'),
    (4, 'carga',    'Vehiculo de carga');

INSERT INTO tipo_espacio (id, codigo, nombre, requiere_reserva) VALUES
    (1, 'compacto',  'Espacio para vehiculo compacto', 0),
    (2, 'grande',    'Espacio para vehiculo grande',   0),
    (3, 'moto',      'Espacio para motocicleta',       0),
    (4, 'carga',     'Espacio de carga y descarga',    0),
    (5, 'reservado', 'Espacio reservado',              1);

-- Reglas de asignacion: primero el espacio ideal, luego las alternativas.
INSERT INTO compatibilidad (tipo_vehiculo_id, tipo_espacio_id, prioridad) VALUES
    (1, 1, 1),   -- compacto -> compacto  (ideal)
    (1, 2, 2),   -- compacto -> grande    (le sobra espacio, pero cabe)
    (1, 5, 3),   -- compacto -> reservado (solo si tiene reserva)
    (2, 2, 1),   -- grande   -> grande
    (2, 5, 3),   -- grande   -> reservado
    (3, 3, 1),   -- moto     -> moto
    (3, 1, 2),   -- moto     -> compacto
    (4, 4, 1),   -- carga    -> carga y descarga
    (4, 2, 2);   -- carga    -> grande

-- 10 espacios: 2 por cada tipo.
-- Sensores FC-51 en pines pares del Mega (22 al 40), LEDs 0..9 en la tira.
INSERT INTO espacio (codigo, tipo_espacio_id, pin_sensor, indice_led) VALUES
    ('E01', 4, 22, 0),   -- carga y descarga
    ('E02', 4, 24, 1),
    ('E03', 5, 26, 2),   -- reservado
    ('E04', 5, 28, 3),
    ('E05', 1, 30, 4),   -- compacto
    ('E06', 1, 32, 5),
    ('E07', 2, 34, 6),   -- grande
    ('E08', 2, 36, 7),
    ('E09', 3, 38, 8),   -- moto
    ('E10', 3, 40, 9);

-- Reservas de ejemplo para poder probar los espacios reservados.
INSERT INTO reserva (espacio_id, placa) VALUES
    ((SELECT id FROM espacio WHERE codigo = 'E03'), 'P555XYZ'),
    ((SELECT id FROM espacio WHERE codigo = 'E04'), 'P777QQQ');


-- =============================================================
-- 9. CONSULTAS CLAVE (referencia para el backend)
--    No se ejecutan aqui, son plantillas con parametros :nombre
-- =============================================================

/*
-- ASIGNAR(placa): encuentra el mejor espacio libre para esa placa.
-- Toda la logica de asignacion automatica cabe en esta consulta.
SELECT e.id, e.codigo, e.indice_led
FROM espacio e
JOIN tipo_espacio   te ON te.id = e.tipo_espacio_id
JOIN compatibilidad c  ON c.tipo_espacio_id = e.tipo_espacio_id
JOIN vehiculo       v  ON v.placa = :placa
WHERE e.estado = 'LIBRE'
  AND c.tipo_vehiculo_id = v.tipo_vehiculo_id
  AND (
        te.requiere_reserva = 0
        OR EXISTS (SELECT 1 FROM reserva r
                   WHERE r.espacio_id = e.id
                     AND r.activa = 1
                     AND r.placa = :placa)
      )
ORDER BY c.prioridad ASC, e.codigo ASC
LIMIT 1;


-- DETECCION DE ALARMA: el sensor dice vacio pero el sistema dice ocupado
-- y nadie autorizo la salida. Se corre cada vez que llega una trama SENS.
SELECT e.id AS espacio_id, o.id AS ocupacion_id, v.placa
FROM espacio e
JOIN ocupacion o ON o.espacio_id = e.id AND o.estado = 'OCUPADO'
JOIN vehiculo  v ON v.id = o.vehiculo_id
WHERE e.sensor_ocupado = 0
  AND e.estado = 'OCUPADO';


-- CONSULTAR(): estado completo del parqueo.
SELECT * FROM v_estado_parqueo ORDER BY espacio;
*/
