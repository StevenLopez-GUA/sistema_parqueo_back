/**
 * PRUEBA DE HUMO
 * Recorre el flujo completo sin navegador y sin maqueta.
 *   npx tsx prueba.ts
 *
 * Sirve para verificar que el interprete, la base de datos y la logica
 * de alarmas funcionan antes de conectar nada.
 */

import { ServicioParqueo } from './src/parqueo/servicio.js';
import { Interprete } from './src/lenguaje/interprete.js';
import { SimuladorArduino } from './src/hardware/transporte.js';
import { reiniciarParqueo } from './src/db/db.js';

const sim = new SimuladorArduino();
const servicio = new ServicioParqueo(sim);
const interprete = new Interprete(servicio);

sim.alRecibir((t) => {
  if (t.tipo === 'SENSOR') servicio.alCambiarSensor(t.indice, t.ocupado);
});
await sim.conectar();
reiniciarParqueo();

let fallos = 0;

function correr(titulo: string, codigo: string) {
  console.log(`\n=== ${titulo} ===`);
  const r = interprete.ejecutar(codigo);
  r.salidas.forEach((s) => console.log(`  ok   ${s.comando}: ${s.mensaje}`));
  r.errores.forEach((e) =>
    console.log(`  ${e.clase.replace('ERROR_', '').padEnd(11)} [${e.linea}:${e.columna}] ${e.mensaje}`)
  );
  return r;
}

function esperar(condicion: boolean, descripcion: string) {
  if (condicion) {
    console.log(`  PASA  ${descripcion}`);
  } else {
    console.log(`  FALLA ${descripcion}`);
    fallos++;
  }
}

// ---------------------------------------------------------------------
// 1. Errores de las tres fases
// ---------------------------------------------------------------------

const e1 = correr('Error lexico', 'REGISTRAR(compacto, 123);');
esperar(e1.errores.some((e) => e.clase === 'ERROR_LEXICO'), 'detecta placa mal formada');

const e2 = correr('Error sintactico', 'ASIGNAR(P123ABC)\nCONSULTAR();');
esperar(e2.errores.some((e) => e.clase === 'ERROR_SINTACTICO'), "detecta ';' faltante");

const e3 = correr('Error semantico', 'ASIGNAR(P999ZZZ);');
esperar(e3.errores.some((e) => e.clase === 'ERROR_SEMANTICO'), 'detecta placa no registrada');

// ---------------------------------------------------------------------
// 2. Flujo feliz completo
// ---------------------------------------------------------------------

correr('Registrar y asignar', 'REGISTRAR(compacto,P123ABC);\nASIGNAR(P123ABC);');
let oc = servicio.ocupacionViva('P123ABC');
esperar(oc?.estado === 'ASIGNADO', `espacio asignado (${oc?.espacio})`);
esperar(oc?.espacio === 'E05', 'eligio el espacio compacto de menor prioridad');

const sinSensor = correr('Llegada sin que el sensor detecte', 'LLEGADA(P123ABC);');
esperar(
  sinSensor.errores.some((e) => e.clase === 'ERROR_SEMANTICO'),
  'bloquea la llegada si el sensor no confirma'
);

console.log('\n=== El vehiculo entra al espacio (sensor indice 4) ===');
sim.moverVehiculo(4, true);

correr('Llegada confirmada', 'LLEGADA(P123ABC);');
oc = servicio.ocupacionViva('P123ABC');
esperar(oc?.estado === 'OCUPADO', 'espacio ocupado y seguridad activa');
esperar(sim.leds[4] === 'ROJO', 'LED del espacio en rojo');

// ---------------------------------------------------------------------
// 3. Alarma por salida no autorizada
// ---------------------------------------------------------------------

console.log('\n=== El vehiculo se mueve SIN autorizacion ===');
sim.moverVehiculo(4, false);

const enAlarma = servicio.estado().find((f) => f.espacio === 'E05');
esperar(enAlarma?.estado === 'ALARMA', 'el espacio entro en alarma');
esperar(enAlarma?.placa === 'P123ABC', 'el sistema identifica que placa genero la alarma');
esperar(sim.alarmaEncendida, 'la sirena de la maqueta esta encendida');

correr('Apagar alarma', 'APAGAR_ALARMA(P123ABC);');
esperar(!sim.alarmaEncendida, 'la sirena se apago');
esperar(
  servicio.estado().find((f) => f.espacio === 'E05')?.estado === 'LIBRE',
  'el espacio quedo libre con salida forzada registrada'
);

// ---------------------------------------------------------------------
// 4. Flujo de salida correcto
// ---------------------------------------------------------------------

correr('Segundo vehiculo', 'REGISTRAR(moto,M456XYZ);');
const errPlaca = correr('Placa fuera de formato', 'ASIGNAR(M456XYZ);');
esperar(errPlaca.errores.length === 0, 'M456XYZ es una placa valida');

sim.moverVehiculo(8, true);
correr('Ciclo completo de la moto', 'LLEGADA(M456XYZ);\nAUTORIZAR_SALIDA(M456XYZ);');

const antesDeSacar = correr('Salida con el vehiculo aun presente', 'SALIDA(M456XYZ);');
esperar(
  antesDeSacar.errores.some((e) => e.clase === 'ERROR_SEMANTICO'),
  'bloquea la salida si el sensor sigue detectando el vehiculo'
);

sim.moverVehiculo(8, false);
correr('Salida correcta', 'SALIDA(M456XYZ);');
esperar(!sim.alarmaEncendida, 'salir con autorizacion NO dispara alarma');
esperar(
  servicio.estado().find((f) => f.espacio === 'E09')?.estado === 'LIBRE',
  'el espacio de moto quedo disponible'
);

// ---------------------------------------------------------------------
// 5. Reservas y compatibilidad
// ---------------------------------------------------------------------

correr('Placa sin reserva', 'REGISTRAR(grande,G111AAA);\nASIGNAR(G111AAA);');
esperar(
  servicio.ocupacionViva('G111AAA')?.espacio === 'E07',
  'un vehiculo grande sin reserva no entra a un espacio reservado'
);

const consulta = correr('Consultar', 'CONSULTAR();');
esperar((consulta.salidas[0]?.tabla?.length ?? 0) === 10, 'CONSULTAR devuelve los 10 espacios');

// ---------------------------------------------------------------------

console.log('\n=====================================');
console.log(fallos === 0 ? 'TODAS LAS PRUEBAS PASARON' : `${fallos} PRUEBAS FALLARON`);
console.log('=====================================');
process.exit(fallos === 0 ? 0 : 1);
