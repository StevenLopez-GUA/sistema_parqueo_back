/**
 * INTERPRETE Y ACCIONES SEMANTICAS
 * Curso: Automatas y Lenguajes Formales
 *
 * Encadena las cuatro fases y ejecuta el programa:
 *
 *   codigo fuente
 *        v
 *   [ LEXER ]      -> tokens        + errores lexicos
 *        v
 *   [ PARSER ]     -> AST           + errores sintacticos
 *        v
 *   [ SEMANTICO ]  -> validacion    + errores semanticos
 *        v
 *   [ ACCIONES ]   -> muta la BD y manda tramas a la maqueta
 *
 * Cada instruccion valida y ejecuta de inmediato antes de pasar a la
 * siguiente, porque los comandos cambian el estado del parqueo.
 * Si una instruccion falla, se reporta y se continua con la siguiente:
 * asi una corrida muestra todos los errores de una sola vez.
 */

import { Lexer, type ErrorLexico, type Token } from './lexer.js';
import { Parser, type ErrorSintactico, type Instruccion } from './parser.js';
import { AnalizadorSemantico, type ErrorSemantico } from './semantico.js';
import type { FilaEstado, ServicioParqueo } from '../parqueo/servicio.js';

export type ErrorCompilacion = ErrorLexico | ErrorSintactico | ErrorSemantico;

export interface SalidaInstruccion {
  comando: string;
  linea: number;
  mensaje: string;
  /** Solo lo llena CONSULTAR() */
  tabla?: FilaEstado[];
}

export interface ResultadoEjecucion {
  tokens: Token[];
  errores: ErrorCompilacion[];
  salidas: SalidaInstruccion[];
  ejecutadas: number;
}

export class Interprete {
  private semantico: AnalizadorSemantico;

  constructor(private servicio: ServicioParqueo) {
    this.semantico = new AnalizadorSemantico(servicio);
  }

  ejecutar(fuente: string): ResultadoEjecucion {
    const errores: ErrorCompilacion[] = [];
    const salidas: SalidaInstruccion[] = [];

    // --- Fase 1: analisis lexico ---
    const { tokens, errores: lexicos } = new Lexer(fuente).analizar();
    errores.push(...lexicos);
    this.anotarErrores(lexicos, fuente);

    // --- Fase 2: analisis sintactico ---
    const { programa, errores: sintacticos } = new Parser(tokens).analizar();
    errores.push(...sintacticos);
    this.anotarErrores(sintacticos, fuente);

    // Con errores lexicos no ejecutamos nada: el AST puede estar incompleto
    // y ejecutar a medias dejaria el parqueo en un estado inconsistente.
    if (lexicos.length > 0) {
      return { tokens, errores, salidas, ejecutadas: 0 };
    }

    // --- Fases 3 y 4: semantico + acciones, instruccion por instruccion ---
    let ejecutadas = 0;

    for (const instr of programa.instrucciones) {
      const errorSem = this.semantico.validar(instr);

      if (errorSem) {
        errores.push(errorSem);
        this.servicio.anotarBitacora({
          origen: 'INTERPRETE',
          comando: this.reconstruir(instr),
          resultado: 'ERROR_SEMANTICO',
          mensaje: errorSem.mensaje,
          linea: errorSem.linea,
          columna: errorSem.columna,
        });
        continue;
      }

      try {
        const salida = this.accionSemantica(instr);
        salidas.push(salida);
        ejecutadas++;

        this.servicio.anotarBitacora({
          origen: 'INTERPRETE',
          comando: this.reconstruir(instr),
          resultado: 'OK',
          mensaje: salida.mensaje,
          linea: instr.linea,
          columna: instr.columna,
        });
      } catch (e) {
        const mensaje = e instanceof Error ? e.message : String(e);
        errores.push({
          clase: 'ERROR_SEMANTICO',
          mensaje: `Fallo al ejecutar ${instr.comando}: ${mensaje}`,
          lexema: instr.comando,
          linea: instr.linea,
          columna: instr.columna,
        });
        this.servicio.anotarBitacora({
          origen: 'INTERPRETE',
          comando: this.reconstruir(instr),
          resultado: 'ERROR_HARDWARE',
          mensaje,
          linea: instr.linea,
          columna: instr.columna,
        });
      }
    }

    return { tokens, errores, salidas, ejecutadas };
  }

  /**
   * ACCIONES SEMANTICAS
   * Una por produccion de la gramatica. Cada una traduce un nodo del AST
   * a operaciones sobre la base de datos y tramas hacia la maqueta.
   */
  private accionSemantica(i: Instruccion): SalidaInstruccion {
    const base = { comando: i.comando, linea: i.linea };

    switch (i.comando) {
      case 'REGISTRAR':
        return { ...base, mensaje: this.servicio.registrar(i.tipoVehiculo, i.placa) };

      case 'ASIGNAR':
        return { ...base, mensaje: this.servicio.asignar(i.placa) };

      case 'LLEGADA':
        return { ...base, mensaje: this.servicio.llegada(i.placa) };

      case 'AUTORIZAR_SALIDA':
        return { ...base, mensaje: this.servicio.autorizarSalida(i.placa) };

      case 'SALIDA':
        return { ...base, mensaje: this.servicio.salida(i.placa) };

      case 'APAGAR_ALARMA':
        return { ...base, mensaje: this.servicio.apagarAlarma(i.placa) };

      case 'CONSULTAR': {
        const tabla = this.servicio.consultar();
        const libres = tabla.filter((f) => f.estado === 'LIBRE').length;
        return {
          ...base,
          mensaje: `${libres} de ${tabla.length} espacios libres`,
          tabla,
        };
      }
    }
  }

  /** Reconstruye el texto del comando desde el AST, para la bitacora. */
  private reconstruir(i: Instruccion): string {
    if (i.comando === 'CONSULTAR') return 'CONSULTAR();';
    if (i.comando === 'REGISTRAR') return `REGISTRAR(${i.tipoVehiculo},${i.placa});`;
    return `${i.comando}(${i.placa});`;
  }

  private anotarErrores(errores: ErrorCompilacion[], fuente: string): void {
    const lineas = fuente.split('\n');
    for (const e of errores) {
      this.servicio.anotarBitacora({
        origen: 'INTERPRETE',
        comando: (lineas[e.linea - 1] ?? '').trim() || e.lexema,
        resultado: e.clase,
        mensaje: e.mensaje,
        linea: e.linea,
        columna: e.columna,
      });
    }
  }
}
