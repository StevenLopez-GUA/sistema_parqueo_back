-- Generado por `npm run bd:sqlserver` desde parqueo.db. No editar a mano.
USE ParqueoUMG;
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DELETE FROM captura;
DELETE FROM bitacora;
DELETE FROM alarma;
DELETE FROM ocupacion;
DELETE FROM reserva;
DELETE FROM vehiculo;
DELETE FROM espacio;
DELETE FROM compatibilidad;
DELETE FROM tipo_espacio;
DELETE FROM tipo_vehiculo;
SET IDENTITY_INSERT tipo_vehiculo ON;
INSERT INTO tipo_vehiculo (id, codigo, nombre) VALUES
  (1, N'compacto', N'Vehiculo compacto'),
  (2, N'grande', N'Vehiculo grande'),
  (3, N'moto', N'Motocicleta'),
  (4, N'carga', N'Vehiculo de carga');
SET IDENTITY_INSERT tipo_vehiculo OFF;
SET IDENTITY_INSERT tipo_espacio ON;
INSERT INTO tipo_espacio (id, codigo, nombre, requiere_reserva) VALUES
  (1, N'compacto', N'Espacio para vehiculo compacto', 0),
  (2, N'grande', N'Espacio para vehiculo grande', 0),
  (3, N'moto', N'Espacio para motocicleta', 0),
  (4, N'carga', N'Espacio de carga y descarga', 0),
  (5, N'reservado', N'Espacio reservado', 1);
SET IDENTITY_INSERT tipo_espacio OFF;
INSERT INTO compatibilidad (tipo_vehiculo_id, tipo_espacio_id, prioridad) VALUES
  (1, 1, 1),
  (1, 2, 2),
  (1, 5, 3),
  (2, 2, 1),
  (2, 5, 3),
  (3, 3, 1),
  (3, 1, 2),
  (4, 4, 1),
  (4, 2, 2);
SET IDENTITY_INSERT espacio ON;
INSERT INTO espacio (id, codigo, tipo_espacio_id, estado, pin_sensor, indice_led, sensor_ocupado, actualizado_en, clave_sensor) VALUES
  (1, N'P1', 4, N'LIBRE', 2, 0, 1, N'2026-10-17 08:56:53', N'carga'),
  (2, N'P2', 5, N'OCUPADO', 3, 1, 1, N'2026-10-16 18:57:03', N'privado1'),
  (3, N'P3', 5, N'LIBRE', 4, 2, 0, N'2026-10-14 22:00:15', N'privado2'),
  (4, N'P4', 1, N'LIBRE', 8, 3, 0, N'2026-10-15 19:05:42', N'libre1'),
  (5, N'P5', 1, N'LIBRE', 12, 4, 0, N'2026-10-14 22:00:15', N'libre2');
SET IDENTITY_INSERT espacio OFF;
SET IDENTITY_INSERT vehiculo ON;
INSERT INTO vehiculo (id, placa, tipo_vehiculo_id, registrado_en) VALUES
  (1, N'C340KSA', 1, N'2026-10-14 22:04:37'),
  (2, N'P054LWN', 1, N'2026-10-14 22:05:47');
SET IDENTITY_INSERT vehiculo OFF;
SET IDENTITY_INSERT reserva ON;
INSERT INTO reserva (id, espacio_id, placa, activa, creada_en) VALUES
  (1, 2, N'P555XYZ', 0, N'2026-10-14 22:00:15'),
  (2, 3, N'P777QQQ', 1, N'2026-10-14 22:00:15'),
  (3, 2, N'P054LWN', 1, N'2026-10-14 22:03:00');
SET IDENTITY_INSERT reserva OFF;
SET IDENTITY_INSERT ocupacion ON;
INSERT INTO ocupacion (id, vehiculo_id, espacio_id, estado, asignado_en, llegada_en, autorizado_en, salida_en, salida_forzada) VALUES
  (1, 1, 4, N'FINALIZADA', N'2026-10-14 22:04:37', N'2026-10-14 22:05:03', N'2026-10-14 22:16:15', N'2026-10-14 22:16:31', 0),
  (2, 2, 2, N'FINALIZADA', N'2026-10-14 22:05:47', N'2026-10-14 22:07:02', N'2026-10-14 22:15:04', N'2026-10-14 22:15:49', 0),
  (3, 1, 4, N'FINALIZADA', N'2026-10-14 22:47:49', N'2026-10-14 22:48:09', N'2026-10-14 22:49:06', N'2026-10-14 22:49:10', 0),
  (4, 2, 2, N'FINALIZADA', N'2026-10-15 19:03:35', N'2026-10-15 19:03:43', N'2026-10-15 19:05:12', N'2026-10-15 19:05:15', 0),
  (5, 1, 4, N'FINALIZADA', N'2026-10-15 19:04:13', N'2026-10-15 19:04:54', N'2026-10-15 19:05:40', N'2026-10-15 19:05:42', 0),
  (6, 2, 2, N'OCUPADO', N'2026-10-16 18:56:57', N'2026-10-16 18:57:03', NULL, NULL, 0);
SET IDENTITY_INSERT ocupacion OFF;
SET IDENTITY_INSERT alarma ON;
INSERT INTO alarma (id, ocupacion_id, espacio_id, motivo, iniciada_en, apagada_en, apagada_por) VALUES
  (1, 3, 4, N'SALIDA_NO_AUTORIZADA', N'2026-10-14 22:48:21', N'2026-10-14 22:48:45', N'OPERADOR'),
  (2, 3, 4, N'SALIDA_NO_AUTORIZADA', N'2026-10-14 22:48:48', N'2026-10-14 22:48:56', N'OPERADOR'),
  (3, NULL, 1, N'OCUPACION_NO_REGISTRADA', N'2026-10-17 08:46:41', N'2026-10-17 08:56:45', N'OPERADOR'),
  (4, NULL, 1, N'OCUPACION_NO_REGISTRADA', N'2026-10-17 08:56:50', N'2026-10-17 08:56:53', N'OPERADOR');
SET IDENTITY_INSERT alarma OFF;
SET IDENTITY_INSERT bitacora ON;
INSERT INTO bitacora (id, origen, comando, resultado, mensaje, linea, columna, espacio_id, vehiculo_id, creado_en) VALUES
  (1, N'INTERPRETE', N'LLEGADA(C340KSA);', N'OK', N'Llegada confirmada en P4. Sistema de seguridad activado', 1, 1, NULL, NULL, N'2026-10-14 22:05:03'),
  (2, N'INTERPRETE', N'LLEGADA(P054LWN);', N'ERROR_SEMANTICO', N'El sensor del espacio P2 no detecta ningun vehiculo. Coloque el vehiculo en el espacio antes de confirmar la llegada.', 1, 1, NULL, NULL, N'2026-10-14 22:06:05'),
  (3, N'INTERPRETE', N'LLEGADA(P054LWN);', N'OK', N'Llegada confirmada en P2. Sistema de seguridad activado', 1, 1, NULL, NULL, N'2026-10-14 22:07:02'),
  (4, N'INTERPRETE', N'AUTORIZAR_SALIDA(P054LWN);', N'OK', N'Salida autorizada para P054LWN. Ya puede retirar el vehiculo de P2', 1, 1, NULL, NULL, N'2026-10-14 22:15:04'),
  (5, N'INTERPRETE', N'SALIDA(P054LWN);', N'ERROR_SEMANTICO', N'El sensor del espacio P2 sigue detectando el vehiculo. Retire el vehiculo antes de registrar la salida.', 1, 1, NULL, NULL, N'2026-10-14 22:15:23'),
  (6, N'INTERPRETE', N'SALIDA(P054LWN);', N'ERROR_SEMANTICO', N'El sensor del espacio P2 sigue detectando el vehiculo. Retire el vehiculo antes de registrar la salida.', 1, 1, NULL, NULL, N'2026-10-14 22:15:34'),
  (7, N'INTERPRETE', N'SALIDA(P054LWN);', N'OK', N'Espacio P2 liberado', 1, 1, NULL, NULL, N'2026-10-14 22:15:49'),
  (8, N'INTERPRETE', N'AUTORIZAR_SALIDA(C340KSA);', N'OK', N'Salida autorizada para C340KSA. Ya puede retirar el vehiculo de P4', 1, 1, NULL, NULL, N'2026-10-14 22:16:15'),
  (9, N'INTERPRETE', N'SALIDA(C340KSA);', N'OK', N'Espacio P4 liberado', 1, 1, NULL, NULL, N'2026-10-14 22:16:31'),
  (10, N'INTERPRETE', N'LLEGADA(C340KSA);', N'OK', N'Llegada confirmada en P4. Sistema de seguridad activado', 1, 1, NULL, NULL, N'2026-10-14 22:48:09'),
  (11, N'SISTEMA', NULL, N'OK', N'Alarma disparada en P4: SALIDA_NO_AUTORIZADA', NULL, NULL, 4, NULL, N'2026-10-14 22:48:21'),
  (12, N'INTERPRETE', N'APAGAR_ALARMA(C340KSA);', N'OK', N'Alarma apagada. C340KSA sigue en P4', 1, 1, NULL, NULL, N'2026-10-14 22:48:45'),
  (13, N'SISTEMA', NULL, N'OK', N'Alarma disparada en P4: SALIDA_NO_AUTORIZADA', NULL, NULL, 4, NULL, N'2026-10-14 22:48:48'),
  (14, N'INTERPRETE', N'APAGAR_ALARMA(C340KSA);', N'OK', N'Alarma apagada. C340KSA sigue en P4', 1, 1, NULL, NULL, N'2026-10-14 22:48:56'),
  (15, N'INTERPRETE', N'AUTORIZAR_SALIDA(C340KSA);', N'OK', N'Salida autorizada para C340KSA. Ya puede retirar el vehiculo de P4', 1, 1, NULL, NULL, N'2026-10-14 22:49:06'),
  (16, N'SENSOR', NULL, N'OK', N'Salida de C340KSA: P4 liberado automaticamente', NULL, NULL, 4, NULL, N'2026-10-14 22:49:10'),
  (17, N'INTERPRETE', N'LLEGADA(P054LWN);', N'OK', N'Llegada confirmada en P2. Sistema de seguridad activado', 1, 1, NULL, NULL, N'2026-10-15 19:03:43'),
  (18, N'INTERPRETE', N'LLEGADA(C340KSA);', N'ERROR_SEMANTICO', N'El sensor del espacio P4 no detecta ningun vehiculo. Coloque el vehiculo en el espacio antes de confirmar la llegada.', 1, 1, NULL, NULL, N'2026-10-15 19:04:17'),
  (19, N'INTERPRETE', N'LLEGADA(C340KSA);', N'ERROR_SEMANTICO', N'El sensor del espacio P4 no detecta ningun vehiculo. Coloque el vehiculo en el espacio antes de confirmar la llegada.', 1, 1, NULL, NULL, N'2026-10-15 19:04:30'),
  (20, N'INTERPRETE', N'LLEGADA(C340KSA);', N'OK', N'Llegada confirmada en P4. Sistema de seguridad activado', 1, 1, NULL, NULL, N'2026-10-15 19:04:54'),
  (21, N'INTERPRETE', N'AUTORIZAR_SALIDA(P054LWN);', N'OK', N'Salida autorizada para P054LWN. Ya puede retirar el vehiculo de P2', 1, 1, NULL, NULL, N'2026-10-15 19:05:12'),
  (22, N'SENSOR', NULL, N'OK', N'Salida de P054LWN: P2 liberado automaticamente', NULL, NULL, 2, NULL, N'2026-10-15 19:05:15'),
  (23, N'INTERPRETE', N'AUTORIZAR_SALIDA(C340KSA);', N'OK', N'Salida autorizada para C340KSA. Ya puede retirar el vehiculo de P4', 1, 1, NULL, NULL, N'2026-10-15 19:05:40'),
  (24, N'SENSOR', NULL, N'OK', N'Salida de C340KSA: P4 liberado automaticamente', NULL, NULL, 4, NULL, N'2026-10-15 19:05:42'),
  (25, N'INTERPRETE', N'LLEGADA(P054LWN);', N'OK', N'Llegada confirmada en P2. Sistema de seguridad activado', 1, 1, NULL, NULL, N'2026-10-16 18:57:03'),
  (26, N'SISTEMA', NULL, N'OK', N'Alarma disparada en P1: OCUPACION_NO_REGISTRADA', NULL, NULL, 1, NULL, N'2026-10-17 08:46:41'),
  (27, N'SISTEMA', NULL, N'OK', N'Alarma sin placa de P1 apagada por el operador', NULL, NULL, 1, NULL, N'2026-10-17 08:56:45'),
  (28, N'SISTEMA', NULL, N'OK', N'Alarma disparada en P1: OCUPACION_NO_REGISTRADA', NULL, NULL, 1, NULL, N'2026-10-17 08:56:50'),
  (29, N'SISTEMA', NULL, N'OK', N'Alarma sin placa de P1 apagada por el operador', NULL, NULL, 1, NULL, N'2026-10-17 08:56:53');
SET IDENTITY_INSERT bitacora OFF;
SET IDENTITY_INSERT captura ON;
INSERT INTO captura (id, momento, motivo, ruta_archivo, bytes, ancho, alto, placa_detectada, metodo_lectura, confianza, placa_confirmada, vehiculo_id, ocupacion_id, alarma_id, espacio_id) VALUES
  (1, N'2026-10-14 22:04:37', N'REGISTRO', N'2026-10-14/220437_REGISTRO_C340KSA.jpg', 30679, 640, 480, N'C340KSA', N'OCR', 86.8, N'C340KSA', 1, 1, NULL, 4),
  (2, N'2026-10-14 22:05:03', N'LLEGADA', N'2026-10-14/220503_LLEGADA_C340KSA.jpg', 31607, 640, 480, N'C?34?KS', N'OCR', 90, N'C340KSA', 1, 1, NULL, 4),
  (3, N'2026-10-14 22:05:47', N'REGISTRO', N'2026-10-14/220547_REGISTRO_P054LWN.jpg', 31234, 640, 480, N'P054LWN', N'OCR', 74.6, N'P054LWN', 2, 2, NULL, 2),
  (4, N'2026-10-14 22:06:05', N'LLEGADA', N'2026-10-14/220605_LLEGADA_P054LWN.jpg', 29500, 640, 480, N'P054LWN', N'OCR', 64.2, N'P054LWN', 2, 2, NULL, 2),
  (5, N'2026-10-14 22:06:24', N'LLEGADA', N'2026-10-14/220624_LLEGADA.jpg', 31385, 640, 480, NULL, N'NINGUNO', NULL, NULL, NULL, NULL, NULL, NULL),
  (6, N'2026-10-14 22:07:02', N'LLEGADA', N'2026-10-14/220702_LLEGADA_P054LWN.jpg', 31457, 640, 480, N'P054LWN', N'OCR', 71.9, N'P054LWN', 2, 2, NULL, 2),
  (7, N'2026-10-14 22:15:04', N'SALIDA', N'2026-10-14/221504_SALIDA_P054LWN.jpg', 30901, 640, 480, N'P054LWN', N'OCR', 72.1, N'P054LWN', 2, 2, NULL, 2),
  (8, N'2026-10-14 22:15:23', N'SALIDA', N'2026-10-14/221523_SALIDA_P054LWN.jpg', 31042, 640, 480, N'P054LWN', N'OCR', 0, N'P054LWN', 2, 2, NULL, 2),
  (9, N'2026-10-14 22:15:34', N'SALIDA', N'2026-10-14/221534_SALIDA_P054LWN.jpg', 31915, 640, 480, N'P054LWN', N'OCR', 0, N'P054LWN', 2, 2, NULL, 2),
  (10, N'2026-10-14 22:15:49', N'SALIDA', N'2026-10-14/221549_SALIDA_P054LWN.jpg', 30800, 640, 480, N'P054LWN', N'OCR', 64.4, N'P054LWN', 2, 2, NULL, 2),
  (11, N'2026-10-14 22:16:15', N'SALIDA', N'2026-10-14/221615_SALIDA_C340KSA.jpg', 33110, 640, 480, N'C340KSA', N'OCR', 90, N'C340KSA', 1, 1, NULL, 4),
  (12, N'2026-10-14 22:16:31', N'SALIDA', N'2026-10-14/221631_SALIDA_C340KSA.jpg', 33296, 640, 480, N'C340KSA', N'OCR', 92, N'C340KSA', 1, 1, NULL, 4),
  (13, N'2026-10-14 22:47:49', N'REGISTRO', N'2026-10-14/224749_REGISTRO_C340KSA.jpg', 29221, 640, 480, N'C340KSA', N'OCR', 90, N'C340KSA', 1, 3, NULL, 4),
  (14, N'2026-10-14 22:48:09', N'LLEGADA', N'2026-10-14/224809_LLEGADA_C340KSA.jpg', 30845, 640, 480, N'C340KSA', N'OCR', 48, N'C340KSA', 1, 3, NULL, 4),
  (15, N'2026-10-14 22:49:06', N'SALIDA', N'2026-10-14/224906_SALIDA_C340KSA.jpg', 31877, 640, 480, N'C340KSA', N'OCR', 89, N'C340KSA', 1, 3, NULL, 4),
  (16, N'2026-10-15 19:03:35', N'REGISTRO', N'2026-10-15/190335_REGISTRO_P054LWN.jpg', 30964, 640, 480, N'P054LWN', N'OCR', 71.6, N'P054LWN', 2, 4, NULL, 2),
  (17, N'2026-10-15 19:03:43', N'LLEGADA', N'2026-10-15/190343_LLEGADA_P054LWN.jpg', 31522, 640, 480, N'P054LWN', N'OCR', 76.9, N'P054LWN', 2, 4, NULL, 2),
  (18, N'2026-10-15 19:04:13', N'REGISTRO', N'2026-10-15/190413_REGISTRO_C340KSA.jpg', 36718, 640, 480, N'C340KSA', N'OCR', 0, N'C340KSA', 1, 5, NULL, 4),
  (19, N'2026-10-15 19:04:17', N'LLEGADA', N'2026-10-15/190417_LLEGADA_C340KSA.jpg', 31937, 640, 480, N'C340KSA', N'OCR', 85.1, N'C340KSA', 1, 5, NULL, 4),
  (20, N'2026-10-15 19:04:30', N'LLEGADA', N'2026-10-15/190430_LLEGADA_C340KSA.jpg', 33572, 640, 480, N'C340KSA', N'OCR', 0, N'C340KSA', 1, 5, NULL, 4),
  (21, N'2026-10-15 19:04:54', N'LLEGADA', N'2026-10-15/190454_LLEGADA_C340KSA.jpg', 34248, 640, 480, N'C340KSM', N'OCR', 0, N'C340KSA', 1, 5, NULL, 4),
  (22, N'2026-10-15 19:05:12', N'SALIDA', N'2026-10-15/190512_SALIDA_P054LWN.jpg', 31572, 640, 480, N'P054LWN', N'OCR', 67.1, N'P054LWN', 2, 4, NULL, 2),
  (23, N'2026-10-15 19:05:40', N'SALIDA', N'2026-10-15/190540_SALIDA_C340KSA.jpg', 34485, 640, 480, N'C340KSA', N'OCR', 0, N'C340KSA', 1, 5, NULL, 4),
  (24, N'2026-10-16 18:56:57', N'REGISTRO', N'2026-10-16/185657_REGISTRO_P054LWN.jpg', 32199, 640, 480, N'P054LWN', N'OCR', 78, N'P054LWN', 2, 6, NULL, 2),
  (25, N'2026-10-16 18:57:03', N'LLEGADA', N'2026-10-16/185703_LLEGADA_P054LWN.jpg', 32358, 640, 480, N'P054LWN', N'OCR', 73.3, N'P054LWN', 2, 6, NULL, 2);
SET IDENTITY_INSERT captura OFF;
COMMIT;
GO
