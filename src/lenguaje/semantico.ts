/**
 * ANALIZADOR SEMANTICO
 * Curso: Automatas y Lenguajes Formales
 *
 * El parser garantiza que la instruccion esta bien ESCRITA.
 * El analizador semantico garantiza que tiene SENTIDO en este momento.
 *
 * Ejemplo: SALIDA(P123ABC); es sintacticamente perfecta, pero es un
 * error semantico si esa placa nunca entro al parqueo.
 *
 * TABLA DE SIMBOLOS
 *   No es una tabla en memoria: es el estado vivo del parqueo en SQLite
 *   (vehiculos registrados, ocupaciones en curso, alarmas activas).
 *   Se consulta a traves de ServicioParqueo.
 *
 * Como los comandos MUTAN el estado, la validacion es secuencial:
 * cada instruccion se valida contra el estado que dejaron las anteriores.
 */

import type { Instruccion } from './parser.js';
import type { ServicioParqueo } from '../parqueo/servicio.js';

export interface ErrorSemantico {
  clase: 'ERROR_SEMANTICO';
  mensaje: string;
  lexema: string;
  linea: number;
  columna: number;
}

export class AnalizadorSemantico {
  constructor(private servicio: ServicioParqueo) {}

  /** Devuelve null si la instruccion es valida, o el error encontrado. */
  validar(instr: Instruccion): ErrorSemantico | null {
    switch (instr.comando) {
      case 'REGISTRAR':
        return this.validarRegistrar(instr);
      case 'ASIGNAR':
        return this.validarAsignar(instr);
      case 'LLEGADA':
        return this.validarLlegada(instr);
      case 'AUTORIZAR_SALIDA':
        return this.validarAutorizarSalida(instr);
      case 'SALIDA':
        return this.validarSalida(instr);
      case 'APAGAR_ALARMA':
        return this.validarApagarAlarma(instr);
      case 'CONSULTAR':
        return null; // siempre valido
    }
  }

  // ------------------------------------------------------------------

  private validarRegistrar(i: Extract<Instruccion, { comando: 'REGISTRAR' }>) {
    const ocupacion = this.servicio.ocupacionViva(i.placa);
    if (ocupacion) {
      return this.err(
        i,
        `La placa ${i.placa} ya esta activa en el parqueo (espacio ${ocupacion.espacio}). ` +
          `Debe salir antes de volver a registrarse.`
      );
    }
    return null;
  }

  private validarAsignar(i: Extract<Instruccion, { comando: 'ASIGNAR' }>) {
    const vehiculo = this.servicio.vehiculoPorPlaca(i.placa);
    if (!vehiculo) {
      return this.err(
        i,
        `La placa ${i.placa} no esta registrada. Ejecute REGISTRAR(tipo,${i.placa}) primero.`
      );
    }

    const ocupacion = this.servicio.ocupacionViva(i.placa);
    if (ocupacion) {
      return this.err(
        i,
        `La placa ${i.placa} ya tiene asignado el espacio ${ocupacion.espacio}.`
      );
    }

    const espacio = this.servicio.mejorEspacioPara(i.placa);
    if (!espacio) {
      return this.err(
        i,
        `No hay espacios libres compatibles con un vehiculo tipo '${vehiculo.tipo}'.`
      );
    }

    return null;
  }

  private validarLlegada(i: Extract<Instruccion, { comando: 'LLEGADA' }>) {
    const oc = this.servicio.ocupacionViva(i.placa);
    if (!oc) {
      return this.err(i, `La placa ${i.placa} no tiene espacio asignado.`);
    }
    if (oc.estado !== 'ASIGNADO') {
      return this.err(
        i,
        `La llegada de ${i.placa} ya fue confirmada (estado actual: ${oc.estado}).`
      );
    }
    // Validacion cruzada con el hardware: el sensor debe confirmar.
    if (oc.sensor_ocupado !== 1) {
      return this.err(
        i,
        `El sensor del espacio ${oc.espacio} no detecta ningun vehiculo. ` +
          `Coloque el vehiculo en el espacio antes de confirmar la llegada.`
      );
    }
    return null;
  }

  private validarAutorizarSalida(i: Extract<Instruccion, { comando: 'AUTORIZAR_SALIDA' }>) {
    const oc = this.servicio.ocupacionViva(i.placa);
    if (!oc) {
      return this.err(i, `La placa ${i.placa} no esta en el parqueo.`);
    }
    if (oc.estado === 'ASIGNADO') {
      return this.err(
        i,
        `${i.placa} tiene espacio asignado pero aun no ha llegado. Falta LLEGADA(${i.placa}).`
      );
    }
    if (oc.estado === 'AUTORIZADO') {
      return this.err(i, `La salida de ${i.placa} ya estaba autorizada.`);
    }
    return null;
  }

  private validarSalida(i: Extract<Instruccion, { comando: 'SALIDA' }>) {
    const oc = this.servicio.ocupacionViva(i.placa);
    if (!oc) {
      return this.err(i, `La placa ${i.placa} no esta en el parqueo.`);
    }
    if (oc.estado !== 'AUTORIZADO') {
      return this.err(
        i,
        `No se puede liberar el espacio de ${i.placa}: la salida no ha sido autorizada. ` +
          `Ejecute AUTORIZAR_SALIDA(${i.placa}) primero.`
      );
    }
    if (oc.sensor_ocupado !== 0) {
      return this.err(
        i,
        `El sensor del espacio ${oc.espacio} sigue detectando el vehiculo. ` +
          `Retire el vehiculo antes de registrar la salida.`
      );
    }
    return null;
  }

  private validarApagarAlarma(i: Extract<Instruccion, { comando: 'APAGAR_ALARMA' }>) {
    const alarma = this.servicio.alarmaActivaDePlaca(i.placa);
    if (!alarma) {
      return this.err(i, `No hay ninguna alarma activa asociada a la placa ${i.placa}.`);
    }
    return null;
  }

  // ------------------------------------------------------------------

  private err(i: Instruccion, mensaje: string): ErrorSemantico {
    return {
      clase: 'ERROR_SEMANTICO',
      mensaje,
      lexema: i.comando,
      linea: i.linea,
      columna: i.columna,
    };
  }
}
