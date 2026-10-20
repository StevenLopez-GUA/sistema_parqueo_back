-- =============================================================
-- MIGRACION 002 — Modulo de camara
-- Sistema Inteligente de Parqueo — UMG
--
-- Agrega el registro de capturas fotograficas y la lectura
-- automatica de placas.
--
-- Se ejecuta sola la primera vez que arranca el backend despues
-- de agregar el modulo. No borra nada de lo que ya existe.
-- =============================================================

-- -------------------------------------------------------------
-- Tabla de capturas
--
-- DECISION DE DISENO: la imagen NO se guarda en la base de datos.
-- Un JPEG de webcam pesa entre 100 y 300 KB; treinta capturas de
-- prueba inflarian el archivo .db y harian lentas todas las
-- consultas. El archivo vive en disco y aqui se guarda su ruta
-- mas los metadatos, que es lo unico que se consulta.
--
-- DECISION DE DISENO: 'placa_detectada' y 'placa_confirmada' son
-- columnas separadas a proposito. La primera es lo que leyo la
-- maquina (puede venir vacia o equivocada); la segunda es lo que
-- el operador valido. Tenerlas separadas permite medir la tasa de
-- acierto del reconocimiento automatico y reportarla.
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS captura (
    id              INTEGER PRIMARY KEY,
    momento         TEXT NOT NULL DEFAULT (datetime('now','localtime')),

    -- En que punto del ciclo se tomo la foto
    motivo          TEXT NOT NULL
                    CHECK (motivo IN ('REGISTRO','LLEGADA','ALARMA','SALIDA','MANUAL')),

    -- Ruta relativa dentro de la carpeta de capturas
    ruta_archivo    TEXT NOT NULL,
    bytes           INTEGER,
    ancho           INTEGER,
    alto            INTEGER,

    -- Lectura automatica
    placa_detectada TEXT,              -- lo que leyo la maquina, puede ser NULL
    metodo_lectura  TEXT NOT NULL DEFAULT 'NINGUNO'
                    CHECK (metodo_lectura IN ('QR','OCR','MANUAL','NINGUNO')),
    confianza       REAL,              -- 0 a 100, solo aplica a OCR

    -- Lectura confirmada por el operador. Esta es la que vale.
    placa_confirmada TEXT,

    -- Enlaces con el resto del sistema (todos opcionales)
    vehiculo_id     INTEGER REFERENCES vehiculo(id),
    ocupacion_id    INTEGER REFERENCES ocupacion(id),
    alarma_id       INTEGER REFERENCES alarma(id),
    espacio_id      INTEGER REFERENCES espacio(id),

    CHECK (confianza IS NULL OR (confianza >= 0 AND confianza <= 100))
);

CREATE INDEX IF NOT EXISTS ix_captura_momento  ON captura(momento);
CREATE INDEX IF NOT EXISTS ix_captura_placa    ON captura(placa_confirmada);
CREATE INDEX IF NOT EXISTS ix_captura_motivo   ON captura(motivo);
CREATE INDEX IF NOT EXISTS ix_captura_vehiculo ON captura(vehiculo_id);

-- -------------------------------------------------------------
-- Vista de consulta: todo lo que la interfaz necesita mostrar
-- sin tener que armar joins desde el frontend.
-- -------------------------------------------------------------

DROP VIEW IF EXISTS v_capturas;

CREATE VIEW v_capturas AS
SELECT
    c.id,
    c.momento,
    c.motivo,
    c.ruta_archivo,
    c.bytes,
    c.placa_detectada,
    c.placa_confirmada,
    c.metodo_lectura,
    c.confianza,
    e.codigo            AS espacio,
    te.codigo           AS tipo_espacio,
    tv.codigo           AS tipo_vehiculo,
    a.motivo            AS motivo_alarma,
    -- 1 si la maquina acerto, 0 si fallo, NULL si no hubo lectura automatica
    CASE
        WHEN c.placa_detectada IS NULL OR c.metodo_lectura IN ('MANUAL','NINGUNO') THEN NULL
        WHEN c.placa_detectada = c.placa_confirmada THEN 1
        ELSE 0
    END                 AS acerto
FROM captura c
LEFT JOIN espacio       e  ON e.id  = c.espacio_id
LEFT JOIN tipo_espacio  te ON te.id = e.tipo_espacio_id
LEFT JOIN vehiculo      v  ON v.id  = c.vehiculo_id
LEFT JOIN tipo_vehiculo tv ON tv.id = v.tipo_vehiculo_id
LEFT JOIN alarma        a  ON a.id  = c.alarma_id;

-- -------------------------------------------------------------
-- Vista de estadisticas del reconocimiento automatico.
-- Sirve directo para el informe: "el OCR acerto 7 de 10 veces".
-- -------------------------------------------------------------

DROP VIEW IF EXISTS v_precision_lectura;

CREATE VIEW v_precision_lectura AS
SELECT
    metodo_lectura,
    COUNT(*)                                        AS intentos,
    SUM(CASE WHEN placa_detectada = placa_confirmada THEN 1 ELSE 0 END) AS aciertos,
    ROUND(
        100.0 * SUM(CASE WHEN placa_detectada = placa_confirmada THEN 1 ELSE 0 END)
        / COUNT(*), 1
    )                                               AS porcentaje,
    ROUND(AVG(confianza), 1)                        AS confianza_promedio
FROM captura
WHERE metodo_lectura IN ('QR','OCR')
  AND placa_confirmada IS NOT NULL
GROUP BY metodo_lectura;
