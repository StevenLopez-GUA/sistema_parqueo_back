-- =============================================================
-- SEMILLA DE LA MAQUETA FISICA — 5 espacios
-- Sistema Inteligente de Parqueo — UMG
--
-- Reemplaza los 10 espacios de desarrollo por los 5 que tiene la
-- maqueta real que esta armando el grupo.
--
-- OJO: borra ocupaciones, alarmas y capturas. Es una semilla, no una
-- migracion. Correr solo cuando se quiera dejar el sistema en cero.
--
--   cd backend
--   npm run bd:maqueta
-- =============================================================

PRAGMA foreign_keys = OFF;

DELETE FROM captura;
DELETE FROM bitacora;
DELETE FROM alarma;
DELETE FROM ocupacion;
DELETE FROM vehiculo;
DELETE FROM reserva;
DELETE FROM espacio;

PRAGMA foreign_keys = ON;

-- -------------------------------------------------------------
-- La columna clave_sensor enlaza cada espacio con la llave que
-- usa el Arduino en su JSON. Es lo que permite traducir
--   {"privado1": true}  ->  espacio E02
-- -------------------------------------------------------------

ALTER TABLE espacio ADD COLUMN clave_sensor TEXT;

-- -------------------------------------------------------------
-- OPCION A — Etiquetado del enunciado (desactivada)
--
-- Los mismos 5 sensores, pero cubriendo los 5 tipos de espacio que
-- pide el PDF del proyecto: carga y descarga, reservado, compacto,
-- grande y motocicleta. No cambia nada del hardware: solo cambia la
-- etiqueta de carton sobre la bahia y esta fila.
-- -------------------------------------------------------------

-- INSERT INTO espacio (codigo, tipo_espacio_id, pin_sensor, indice_led, clave_sensor) VALUES
--     ('P1', 4,  2, 0, 'carga'),      -- carga y descarga
--     ('P2', 5,  3, 1, 'privado1'),   -- reservado
--     ('P3', 1,  4, 2, 'privado2'),   -- compacto
--     ('P4', 2,  8, 3, 'libre1'),     -- grande
--     ('P5', 3, 12, 4, 'libre2');     -- motocicleta

-- -- Reserva de ejemplo para poder probar el espacio reservado.
-- INSERT INTO reserva (espacio_id, placa) VALUES
--     ((SELECT id FROM espacio WHERE codigo = 'P2'), 'P555XYZ');

-- -------------------------------------------------------------
-- OPCION B — Etiquetado del grupo (ACTIVA): 1 carga, 2 privados, 2 libres
--
-- Carga / privados / libres, como esta rotulada la maqueta. Para volver
-- a la opcion A, comentar este bloque y descomentar el de arriba.
--
INSERT INTO espacio (codigo, tipo_espacio_id, pin_sensor, indice_led, clave_sensor) VALUES
    ('P1', 4,  2, 0, 'carga'),
    ('P2', 5,  3, 1, 'privado1'),
    ('P3', 5,  4, 2, 'privado2'),
    ('P4', 1,  8, 3, 'libre1'),
    ('P5', 1, 12, 4, 'libre2');

INSERT INTO reserva (espacio_id, placa) VALUES
    ((SELECT id FROM espacio WHERE codigo = 'P2'), 'P555XYZ'),
    ((SELECT id FROM espacio WHERE codigo = 'P3'), 'P777QQQ');
-- -------------------------------------------------------------
