/**
 * PRUEBA DEL MODULO DE CAMARA
 *   npx tsx prueba-camara.ts
 *
 * Verifica el guardado en disco, el enlace automatico con el vehiculo
 * y la ocupacion, los filtros de consulta y el calculo de precision.
 * Usa un JPEG minimo generado en memoria, sin necesidad de webcam.
 */

import { ServicioCaptura, RAIZ_CAPTURAS } from './src/camara/servicio-captura.js';
import { ServicioParqueo } from './src/parqueo/servicio.js';
import { Interprete } from './src/lenguaje/interprete.js';
import { SimuladorArduino } from './src/hardware/transporte.js';
import { reiniciarParqueo, db } from './src/db/db.js';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Limpiamos capturas de corridas anteriores para que las cuentas cuadren.
if (existsSync(RAIZ_CAPTURAS)) rmSync(RAIZ_CAPTURAS, { recursive: true, force: true });
db.prepare('DELETE FROM captura').run();

const sim = new SimuladorArduino();
const servicio = new ServicioParqueo(sim);
const interprete = new Interprete(servicio);
const camara = new ServicioCaptura();

sim.alRecibir((t) => {
  if (t.tipo === 'SENSOR') servicio.alCambiarSensor(t.indice, t.ocupado);
});
await sim.conectar();
reiniciarParqueo();

let fallos = 0;
const esperar = (cond: boolean, desc: string) => {
  console.log(`  ${cond ? 'PASA ' : 'FALLA'} ${desc}`);
  if (!cond) fallos++;
};

/** JPEG valido de 1x1 pixel, suficiente para probar el guardado. */
const JPEG_MINIMO =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

console.log('\n=== Preparar un vehiculo en el parqueo ===');
interprete.ejecutar('REGISTRAR(compacto,P123ABC);\nASIGNAR(P123ABC);');
sim.moverVehiculo(4, true);
interprete.ejecutar('LLEGADA(P123ABC);');
console.log('  P123ABC ocupa E05');

// ---------------------------------------------------------------------

console.log('\n=== Captura al registrar, con lectura por QR ===');
const c1: any = camara.guardar({
  imagen: JPEG_MINIMO,
  motivo: 'REGISTRO',
  placaDetectada: 'P123ABC',
  placaConfirmada: 'P123ABC',
  metodoLectura: 'QR',
  ancho: 640,
  alto: 480,
});

esperar(c1.id > 0, 'la captura se registro en la base de datos');
esperar(existsSync(join(RAIZ_CAPTURAS, c1.ruta_archivo)), `el archivo existe en disco (${c1.ruta_archivo})`);
esperar(c1.espacio === 'E05', 'se enlazo sola con el espacio del vehiculo');
esperar(c1.acerto === 1, 'el QR se marco como lectura acertada');

// ---------------------------------------------------------------------

console.log('\n=== Captura con OCR equivocado y correccion del operador ===');
const c2: any = camara.guardar({
  imagen: JPEG_MINIMO,
  motivo: 'LLEGADA',
  placaDetectada: 'P1Z3ABC',   // el OCR confundio el 2 con una Z
  placaConfirmada: 'P123ABC',  // el operador lo corrigio
  metodoLectura: 'OCR',
  confianza: 61.4,
});

esperar(c2.acerto === 0, 'la lectura fallida quedo marcada como error');
esperar(c2.placa_confirmada === 'P123ABC', 'se guardo la placa que confirmo el operador');
esperar(c2.placa_detectada === 'P1Z3ABC', 'se conservo lo que leyo la maquina, para poder medirlo');

// ---------------------------------------------------------------------

console.log('\n=== Captura automatica al dispararse la alarma ===');
sim.moverVehiculo(4, false); // salida sin autorizacion

const enAlarma: any = servicio.estado().find((f) => f.espacio === 'E05');
esperar(enAlarma.estado === 'ALARMA', 'la alarma se disparo');

const idAlarma = (
  db.prepare('SELECT id FROM alarma WHERE apagada_en IS NULL').get() as { id: number }
).id;

const c3: any = camara.guardar({
  imagen: JPEG_MINIMO,
  motivo: 'ALARMA',
  placaConfirmada: 'P123ABC',
  metodoLectura: 'MANUAL',
  alarmaId: idAlarma,
  espacioId: enAlarma.espacio_id,
});

esperar(c3.motivo_alarma === 'SALIDA_NO_AUTORIZADA', 'la foto quedo ligada al motivo de la alarma');
esperar(c3.acerto === null, 'una captura manual no cuenta para la precision');

// ---------------------------------------------------------------------

console.log('\n=== Consultas ===');
const porPlaca = camara.buscar({ placa: 'P123ABC' });
esperar(porPlaca.length === 3, `busqueda por placa devuelve las 3 capturas (${porPlaca.length})`);

const soloAlarmas = camara.buscar({ motivo: 'ALARMA' });
esperar(soloAlarmas.length === 1, 'filtro por motivo ALARMA devuelve 1');

const fallidas = camara.buscar({ soloFallos: true });
esperar(fallidas.length === 1, 'filtro de lecturas fallidas devuelve 1');

const historial: any[] = camara.historialDePlaca('P123ABC');
esperar(historial.length === 3, 'el historial de la placa trae las 3 fotos');
esperar(
  historial[0].momento <= historial[2].momento,
  'el historial viene en orden cronologico'
);

const archivo = camara.leerArchivo(c1.id);
esperar(archivo !== null && archivo.bytes > 0, 'el archivo se puede leer de vuelta');

// ---------------------------------------------------------------------

console.log('\n=== Precision del reconocimiento ===');
const precision: any[] = camara.precisionLectura();
const qr = precision.find((p) => p.metodo_lectura === 'QR');
const ocr = precision.find((p) => p.metodo_lectura === 'OCR');

esperar(qr?.porcentaje === 100, `QR al 100% de acierto (${qr?.porcentaje}%)`);
esperar(ocr?.porcentaje === 0, `OCR al 0% en esta muestra (${ocr?.porcentaje}%)`);

console.log('\n  Tabla lista para el informe:');
precision.forEach((p: any) =>
  console.log(`    ${p.metodo_lectura.padEnd(4)} ${p.aciertos}/${p.intentos} aciertos = ${p.porcentaje}%`)
);

console.log('\n=====================================');
console.log(fallos === 0 ? 'TODAS LAS PRUEBAS PASARON' : `${fallos} PRUEBAS FALLARON`);
console.log('=====================================');
process.exit(fallos === 0 ? 0 : 1);
