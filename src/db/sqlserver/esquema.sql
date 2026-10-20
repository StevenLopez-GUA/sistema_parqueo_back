-- =============================================================
-- SISTEMA INTELIGENTE DE PARQUEO
-- Universidad Mariano Galvez de Guatemala - Ingenieria en Sistemas
--
-- Motor: SQL Server 2017+ (version T-SQL de ../esquema.sql y
--        ../migracion_camara.sql). Solo estructura: los datos los
--        genera `npm run bd:sqlserver` en datos.sql.
--
-- Se puede correr varias veces: borra y recrea las tablas.
-- =============================================================

IF DB_ID('ParqueoUMG') IS NULL CREATE DATABASE ParqueoUMG;
GO
USE ParqueoUMG;
GO

DROP TABLE IF EXISTS captura, bitacora, alarma, ocupacion, reserva,
                     vehiculo, espacio, compatibilidad, tipo_espacio, tipo_vehiculo;
GO


-- =============================================================
-- 1. CATALOGOS
-- =============================================================

CREATE TABLE tipo_vehiculo (
    id      INT IDENTITY PRIMARY KEY,
    codigo  VARCHAR(20)  NOT NULL UNIQUE,   -- token del lenguaje formal: 'compacto'
    nombre  VARCHAR(100) NOT NULL
);

-- requiere_reserva = 1: solo se asigna a placas con reserva vigente.
CREATE TABLE tipo_espacio (
    id                INT IDENTITY PRIMARY KEY,
    codigo            VARCHAR(20)  NOT NULL UNIQUE,
    nombre            VARCHAR(100) NOT NULL,
    requiere_reserva  BIT NOT NULL DEFAULT 0
);

-- prioridad 1 = espacio ideal, 2 = alternativa, 3 = ultimo recurso.
CREATE TABLE compatibilidad (
    tipo_vehiculo_id INT NOT NULL REFERENCES tipo_vehiculo(id) ON DELETE CASCADE,
    tipo_espacio_id  INT NOT NULL REFERENCES tipo_espacio(id)  ON DELETE CASCADE,
    prioridad        TINYINT NOT NULL DEFAULT 1 CHECK (prioridad BETWEEN 1 AND 9),
    PRIMARY KEY (tipo_vehiculo_id, tipo_espacio_id)
);


-- =============================================================
-- 2. ESPACIOS FISICOS DE LA MAQUETA
-- =============================================================

-- 'estado' esta desnormalizado a proposito (el historico vive en 'ocupacion').
CREATE TABLE espacio (
    id               INT IDENTITY PRIMARY KEY,
    codigo           VARCHAR(10) NOT NULL UNIQUE,
    tipo_espacio_id  INT NOT NULL REFERENCES tipo_espacio(id),

    estado           VARCHAR(20) NOT NULL DEFAULT 'LIBRE'
                     CHECK (estado IN ('LIBRE','ASIGNADO','OCUPADO',
                                       'AUTORIZADO','ALARMA','FUERA_SERVICIO')),

    pin_sensor       INT NOT NULL UNIQUE,
    indice_led       INT NOT NULL UNIQUE,
    sensor_ocupado   BIT NOT NULL DEFAULT 0,   -- ultima lectura cruda del sensor
    actualizado_en   DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
    clave_sensor     VARCHAR(30) NULL          -- llave del JSON del Arduino: 'privado1'
);

CREATE INDEX ix_espacio_estado ON espacio(estado);
CREATE INDEX ix_espacio_tipo   ON espacio(tipo_espacio_id);


-- =============================================================
-- 3. VEHICULOS Y RESERVAS
-- =============================================================

CREATE TABLE vehiculo (
    id                INT IDENTITY PRIMARY KEY,
    placa             VARCHAR(7) NOT NULL UNIQUE,
    tipo_vehiculo_id  INT NOT NULL REFERENCES tipo_vehiculo(id),
    registrado_en     DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),

    -- Placa de Guatemala: P123ABC. COLLATE binario para exigir mayusculas
    -- (la intercalacion por defecto de SQL Server no distingue mayusculas).
    CONSTRAINT ck_vehiculo_placa
        CHECK (placa COLLATE Latin1_General_BIN LIKE '[A-Z][0-9][0-9][0-9][A-Z][A-Z][A-Z]')
);

CREATE TABLE reserva (
    id          INT IDENTITY PRIMARY KEY,
    espacio_id  INT NOT NULL REFERENCES espacio(id) ON DELETE CASCADE,
    placa       VARCHAR(7) NOT NULL,
    activa      BIT NOT NULL DEFAULT 1,
    creada_en   DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
);

-- Indice UNIQUE FILTRADO: una sola reserva activa por espacio.
CREATE UNIQUE INDEX ux_reserva_espacio_activa
    ON reserva(espacio_id) WHERE activa = 1;


-- =============================================================
-- 4. OCUPACIONES (ciclo ASIGNADO -> OCUPADO -> AUTORIZADO -> FINALIZADA)
-- =============================================================

CREATE TABLE ocupacion (
    id              INT IDENTITY PRIMARY KEY,
    vehiculo_id     INT NOT NULL REFERENCES vehiculo(id),
    espacio_id      INT NOT NULL REFERENCES espacio(id),

    estado          VARCHAR(20) NOT NULL DEFAULT 'ASIGNADO'
                    CHECK (estado IN ('ASIGNADO','OCUPADO','AUTORIZADO',
                                      'FINALIZADA','CANCELADA')),

    asignado_en     DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
    llegada_en      DATETIME2(0) NULL,
    autorizado_en   DATETIME2(0) NULL,
    salida_en       DATETIME2(0) NULL,
    salida_forzada  BIT NOT NULL DEFAULT 0,   -- 1 si salio sin autorizacion

    CONSTRAINT ck_ocupacion_llegada    CHECK (llegada_en    IS NULL OR llegada_en >= asignado_en),
    CONSTRAINT ck_ocupacion_autorizado CHECK (autorizado_en IS NULL OR llegada_en IS NOT NULL),
    CONSTRAINT ck_ocupacion_salida     CHECK (salida_en     IS NULL OR llegada_en IS NOT NULL)
);

-- Reglas de oro garantizadas por la BD:
--   * un espacio no puede tener dos ocupaciones vivas
--   * un vehiculo no puede estar en dos espacios a la vez
CREATE UNIQUE INDEX ux_ocupacion_espacio_viva
    ON ocupacion(espacio_id)  WHERE estado IN ('ASIGNADO','OCUPADO','AUTORIZADO');
CREATE UNIQUE INDEX ux_ocupacion_vehiculo_viva
    ON ocupacion(vehiculo_id) WHERE estado IN ('ASIGNADO','OCUPADO','AUTORIZADO');

CREATE INDEX ix_ocupacion_espacio ON ocupacion(espacio_id);
CREATE INDEX ix_ocupacion_estado  ON ocupacion(estado);


-- =============================================================
-- 5. ALARMAS
-- =============================================================

CREATE TABLE alarma (
    id            INT IDENTITY PRIMARY KEY,
    ocupacion_id  INT NULL REFERENCES ocupacion(id),
    espacio_id    INT NOT NULL REFERENCES espacio(id),

    motivo        VARCHAR(30) NOT NULL DEFAULT 'SALIDA_NO_AUTORIZADA'
                  CHECK (motivo IN ('SALIDA_NO_AUTORIZADA','MOVIMIENTO_NO_AUTORIZADO',
                                    'OCUPACION_NO_REGISTRADA','MANUAL')),

    iniciada_en   DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
    apagada_en    DATETIME2(0) NULL,
    apagada_por   VARCHAR(50)  NULL
);

-- Un espacio no puede tener dos alarmas sonando al mismo tiempo.
CREATE UNIQUE INDEX ux_alarma_espacio_activa
    ON alarma(espacio_id) WHERE apagada_en IS NULL;


-- =============================================================
-- 6. BITACORA
-- =============================================================

CREATE TABLE bitacora (
    id           INT IDENTITY PRIMARY KEY,
    origen       VARCHAR(20) NOT NULL CHECK (origen IN ('INTERPRETE','SENSOR','SISTEMA')),
    comando      NVARCHAR(MAX) NULL,
    resultado    VARCHAR(20) NOT NULL
                 CHECK (resultado IN ('OK','ERROR_LEXICO','ERROR_SINTACTICO',
                                      'ERROR_SEMANTICO','ERROR_HARDWARE')),
    mensaje      NVARCHAR(MAX) NULL,
    linea        INT NULL,
    columna      INT NULL,
    espacio_id   INT NULL REFERENCES espacio(id),
    vehiculo_id  INT NULL REFERENCES vehiculo(id),
    creado_en    DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
);

CREATE INDEX ix_bitacora_fecha     ON bitacora(creado_en);
CREATE INDEX ix_bitacora_resultado ON bitacora(resultado);


-- =============================================================
-- 7. CAPTURAS DE CAMARA (la imagen vive en disco, aqui solo la ruta)
-- =============================================================

CREATE TABLE captura (
    id               INT IDENTITY PRIMARY KEY,
    momento          DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
    motivo           VARCHAR(20) NOT NULL
                     CHECK (motivo IN ('REGISTRO','LLEGADA','ALARMA','SALIDA','MANUAL')),
    ruta_archivo     NVARCHAR(400) NOT NULL,
    bytes            INT NULL,
    ancho            INT NULL,
    alto             INT NULL,
    placa_detectada  VARCHAR(20) NULL,   -- lo que leyo la maquina
    metodo_lectura   VARCHAR(10) NOT NULL DEFAULT 'NINGUNO'
                     CHECK (metodo_lectura IN ('QR','OCR','MANUAL','NINGUNO')),
    confianza        DECIMAL(5,2) NULL CHECK (confianza BETWEEN 0 AND 100),
    placa_confirmada VARCHAR(20) NULL,   -- lo que valido el operador
    vehiculo_id      INT NULL REFERENCES vehiculo(id),
    ocupacion_id     INT NULL REFERENCES ocupacion(id),
    alarma_id        INT NULL REFERENCES alarma(id),
    espacio_id       INT NULL REFERENCES espacio(id)
);

CREATE INDEX ix_captura_momento  ON captura(momento);
CREATE INDEX ix_captura_placa    ON captura(placa_confirmada);
CREATE INDEX ix_captura_motivo   ON captura(motivo);
CREATE INDEX ix_captura_vehiculo ON captura(vehiculo_id);
GO


-- =============================================================
-- 8. VISTAS (en T-SQL cada CREATE VIEW va en su propio lote: GO)
-- =============================================================

-- Respuesta del comando CONSULTAR() y del mapa en React.
CREATE OR ALTER VIEW v_estado_parqueo AS
SELECT
    e.id           AS espacio_id,
    e.codigo       AS espacio,
    te.codigo      AS tipo_espacio,
    e.estado,
    e.indice_led,
    e.sensor_ocupado,
    v.placa,
    tv.codigo      AS tipo_vehiculo,
    o.id           AS ocupacion_id,
    o.llegada_en,
    o.autorizado_en,
    CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END AS en_alarma
FROM espacio e
JOIN tipo_espacio te ON te.id = e.tipo_espacio_id
LEFT JOIN ocupacion o
       ON o.espacio_id = e.id
      AND o.estado IN ('ASIGNADO','OCUPADO','AUTORIZADO')
LEFT JOIN vehiculo v       ON v.id  = o.vehiculo_id
LEFT JOIN tipo_vehiculo tv ON tv.id = v.tipo_vehiculo_id
LEFT JOIN alarma a
       ON a.espacio_id = e.id
      AND a.apagada_en IS NULL;
GO

CREATE OR ALTER VIEW v_disponibilidad AS
SELECT
    te.codigo AS tipo_espacio,
    COUNT(*)  AS total,
    SUM(CASE WHEN e.estado = 'LIBRE' THEN 1 ELSE 0 END) AS libres
FROM espacio e
JOIN tipo_espacio te ON te.id = e.tipo_espacio_id
GROUP BY te.codigo;
GO

CREATE OR ALTER VIEW v_capturas AS
SELECT
    c.id, c.momento, c.motivo, c.ruta_archivo, c.bytes,
    c.placa_detectada, c.placa_confirmada, c.metodo_lectura, c.confianza,
    e.codigo   AS espacio,
    te.codigo  AS tipo_espacio,
    tv.codigo  AS tipo_vehiculo,
    a.motivo   AS motivo_alarma,
    -- 1 si la maquina acerto, 0 si fallo, NULL si no hubo lectura automatica
    CASE
        WHEN c.placa_detectada IS NULL OR c.metodo_lectura IN ('MANUAL','NINGUNO') THEN NULL
        WHEN c.placa_detectada = c.placa_confirmada THEN 1
        ELSE 0
    END        AS acerto
FROM captura c
LEFT JOIN espacio       e  ON e.id  = c.espacio_id
LEFT JOIN tipo_espacio  te ON te.id = e.tipo_espacio_id
LEFT JOIN vehiculo      v  ON v.id  = c.vehiculo_id
LEFT JOIN tipo_vehiculo tv ON tv.id = v.tipo_vehiculo_id
LEFT JOIN alarma        a  ON a.id  = c.alarma_id;
GO

CREATE OR ALTER VIEW v_precision_lectura AS
SELECT
    metodo_lectura,
    COUNT(*) AS intentos,
    SUM(CASE WHEN placa_detectada = placa_confirmada THEN 1 ELSE 0 END) AS aciertos,
    ROUND(100.0 * SUM(CASE WHEN placa_detectada = placa_confirmada THEN 1 ELSE 0 END)
          / COUNT(*), 1) AS porcentaje,
    ROUND(AVG(confianza), 1) AS confianza_promedio
FROM captura
WHERE metodo_lectura IN ('QR','OCR')
  AND placa_confirmada IS NOT NULL
GROUP BY metodo_lectura;
GO
