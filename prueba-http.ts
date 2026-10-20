/**
 * PRUEBA DE INTEGRACION CON LA MAQUETA POR WIFI
 *   npx tsx prueba-http.ts
 *
 * Simula los POST que manda el Arduino R4 y verifica que el sistema
 * responda con las ordenes correctas. No necesita hardware ni red.
 */

import { TransporteHttp } from './src/hardware/transporte-http.js';
import { ServicioParqueo } from './src/parqueo/servicio.js';
import { Interprete } from './src/lenguaje/interprete.js';
import { db, reiniciarParqueo } from './src/db/db.js';

// --- Dejar la BD con los 5 espacios de la maqueta ---
db.exec(`
  PRAGMA foreign_keys = OFF;
  DELETE FROM captura; DELETE FROM bitacora; DELETE FROM alarma;
  DELETE FROM ocupacion; DELETE FROM vehiculo; DELETE FROM reserva;
  DELETE FROM espacio;
  PRAGMA foreign_keys = ON;
`);

const columnas = db.prepare('PRAGMA table_info(espacio)').all() as { name: string }[];
if (!columnas.some((c) => c.name === 'clave_sensor')) {
  db.exec('ALTER TABLE espacio ADD COLUMN clave_sensor TEXT');
}

db.exec(`
  INSERT INTO espacio (codigo, tipo_espacio_id, pin_sensor, indice_led, clave_sensor) VALUES
    ('P1', 4,  2, 0, 'carga'),
    ('P2', 5,  3, 1, 'privado1'),
    ('P3', 1,  4, 2, 'privado2'),
    ('P4', 2,  8, 3, 'libre1'),
    ('P5', 3, 12, 4, 'libre2');
`);

const http = new TransporteHttp();
const servicio = new ServicioParqueo(http);
const interprete = new Interprete(servicio);

http.alRecibir((t) => {
  if (t.tipo === 'SENSOR') servicio.alCambiarSensor(t.indice, t.ocupado);
});
await http.conectar();

let fallos = 0;
const esperar = (cond: boolean, desc: string) => {
  console.log(`  ${cond ? 'PASA ' : 'FALLA'} ${desc}`);
  if (!cond) fallos++;
};

/** Simula un POST del Arduino con el estado indicado. */
const postear = (estado: Record<string, boolean>) =>
  http.recibirEstado({
    carga: false, privado1: false, privado2: false,
    libre1: false, libre2: false, talanquera: false,
    ...estado,
  });

// ---------------------------------------------------------------------

console.log('\n=== Estado inicial: parqueo vacio ===');
let r = postear({});
esperar(r.entra === 0, 'sin autorizacion, la talanquera no abre');
esperar(r.semaforo === 'ROJO', 'el semaforo esta en rojo');

// ---------------------------------------------------------------------

console.log('\n=== Llega un vehiculo a la entrada ===');
r = postear({ talanquera: true });
esperar(r.entra === 0, 'el solo hecho de llegar no abre la talanquera');

console.log('\n=== El operador lo registra y le asigna espacio ===');
const res = interprete.ejecutar('REGISTRAR(compacto,P123ABC);\nASIGNAR(P123ABC);');
esperar(res.errores.length === 0, 'los comandos se ejecutaron sin errores');

const oc = servicio.ocupacionViva('P123ABC');
esperar(oc?.espacio === 'P3', `se asigno el espacio compacto P3 (${oc?.espacio})`);

r = postear({ talanquera: true });
esperar(r.entra === 1, 'ASIGNAR abrio la talanquera');
esperar(r.semaforo === 'VERDE', 'el semaforo se puso en verde');
esperar(r.mensaje.includes('P3'), `el mensaje le dice a donde ir: "${r.mensaje}"`);

// ---------------------------------------------------------------------

console.log('\n=== El vehiculo cruza la talanquera ===');
r = postear({ talanquera: false });
esperar(r.entra === 0, 'el permiso se consume al cruzar, no reabre sola');
esperar(r.semaforo === 'ROJO', 'el semaforo vuelve a rojo');

console.log('\n=== Se estaciona en P3 ===');
postear({ privado2: true });   // privado2 es la clave del sensor de P3

const llegada = interprete.ejecutar('LLEGADA(P123ABC);');
esperar(llegada.errores.length === 0, 'LLEGADA aceptada porque el sensor confirma');
esperar(
  servicio.estado().find((f) => f.espacio === 'P3')?.estado === 'OCUPADO',
  'P3 quedo ocupado'
);

// ---------------------------------------------------------------------

console.log('\n=== Se mueve sin autorizacion ===');
postear({ privado2: false });

const alarmado: any = servicio.estado().find((f) => f.espacio === 'P3');
esperar(alarmado.estado === 'ALARMA', 'se disparo la alarma');
esperar(alarmado.placa === 'P123ABC', 'el sistema sabe que placa la genero');

r = postear({});
esperar(r.alarma === true, 'el Arduino recibe la orden de alarma');
esperar(r.semaforo === 'AMARILLO', 'el semaforo pasa a amarillo durante la alarma');

interprete.ejecutar('APAGAR_ALARMA(P123ABC);');
r = postear({});
esperar(r.alarma === false, 'la alarma se apago');

// ---------------------------------------------------------------------

console.log('\n=== Salida correcta de otro vehiculo ===');
interprete.ejecutar('REGISTRAR(moto,M456XYZ);\nASIGNAR(M456XYZ);');
esperar(servicio.ocupacionViva('M456XYZ')?.espacio === 'P5', 'la moto fue a P5');

postear({ libre2: true });
interprete.ejecutar('LLEGADA(M456XYZ);');

r = postear({ libre2: true });
esperar(r.entra === 0, 'estando parqueada, la talanquera sigue cerrada');

interprete.ejecutar('AUTORIZAR_SALIDA(M456XYZ);');
r = postear({ libre2: true });
esperar(r.entra === 1, 'AUTORIZAR_SALIDA abre la talanquera para salir');

// La moto deja el espacio: P5 se libera solo y la talanquera sigue
// abierta, porque la moto todavia tiene que cruzarla.
r = postear({ libre2: false });
esperar(
  servicio.estado().find((f) => f.espacio === 'P5')?.estado === 'LIBRE',
  'P5 quedo disponible sin ejecutar SALIDA'
);
esperar(r.alarma === false, 'salir con autorizacion no dispara alarma');
esperar(r.entra === 1, 'la talanquera sigue abierta para que la moto la cruce');

postear({ talanquera: true });
r = postear({ talanquera: false });
esperar(r.entra === 0, 'al cruzar la talanquera el permiso se consume');

// ---------------------------------------------------------------------

console.log('\n=== Robustez ===');
r = http.recibirEstado({});
esperar(r.entra === 0 && r.semaforo !== undefined, 'un POST vacio no rompe el sistema');

r = http.recibirEstado({ carga: 'true' as any });
esperar(r.semaforo !== undefined, 'acepta booleanos mandados como texto');

const diag = http.diagnostico();
esperar(diag.enLinea === true, 'el diagnostico reporta la maqueta en linea');

console.log('\n=====================================');
console.log(fallos === 0 ? 'TODAS LAS PRUEBAS PASARON' : `${fallos} PRUEBAS FALLARON`);
console.log('=====================================');
process.exit(fallos === 0 ? 0 : 1);
