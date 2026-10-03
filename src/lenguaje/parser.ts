/**
 * ANALIZADOR SINTACTICO
 * Curso: Automatas y Lenguajes Formales
 *
 * Parser descendente recursivo (LL(1)) escrito a mano.
 * Cada no terminal de la gramatica es un metodo de esta clase.
 *
 * GRAMATICA LIBRE DE CONTEXTO
 *   <programa>    -> <instruccion> <programa> | epsilon
 *   <instruccion> -> <comando> ';'
 *   <comando>     -> 'REGISTRAR' '(' TIPO_VEHICULO ',' PLACA ')'
 *                  | 'ASIGNAR'          '(' PLACA ')'
 *                  | 'LLEGADA'          '(' PLACA ')'
 *                  | 'AUTORIZAR_SALIDA' '(' PLACA ')'
 *                  | 'SALIDA'           '(' PLACA ')'
 *                  | 'APAGAR_ALARMA'    '(' PLACA ')'
 *                  | 'CONSULTAR'        '(' ')'
 *
 * CONJUNTOS PRIMERO / SIGUIENTE
 *   PRIMERO(<programa>)    = { COMANDO, epsilon }
 *   PRIMERO(<instruccion>) = { COMANDO }
 *   PRIMERO(<comando>)     = { COMANDO }
 *   SIGUIENTE(<programa>)  = { $ }
 *   SIGUIENTE(<comando>)   = { ';' }
 *
 * La gramatica es LL(1): ninguna produccion comparte primer token con otra,
 * asi que basta con mirar un token adelante y no hay retroceso.
 *
 * RECUPERACION DE ERRORES
 *   Modo panico: al fallar, se descartan tokens hasta el siguiente ';'
 *   y se continua. Asi un archivo con varios errores los reporta todos
 *   en una sola corrida, en lugar de morir en el primero.
 */

import type { Token, TipoToken } from './lexer.js';

export interface Posicion {
  linea: number;
  columna: number;
}

export type Instruccion =
  | ({ comando: 'REGISTRAR'; tipoVehiculo: string; placa: string } & Posicion)
  | ({ comando: 'ASIGNAR'; placa: string } & Posicion)
  | ({ comando: 'LLEGADA'; placa: string } & Posicion)
  | ({ comando: 'AUTORIZAR_SALIDA'; placa: string } & Posicion)
  | ({ comando: 'SALIDA'; placa: string } & Posicion)
  | ({ comando: 'APAGAR_ALARMA'; placa: string } & Posicion)
  | ({ comando: 'CONSULTAR' } & Posicion);

export interface Programa {
  instrucciones: Instruccion[];
}

export interface ErrorSintactico {
  clase: 'ERROR_SINTACTICO';
  mensaje: string;
  lexema: string;
  linea: number;
  columna: number;
}

export interface ResultadoSintactico {
  programa: Programa;
  errores: ErrorSintactico[];
}

/** Comandos que reciben exactamente una placa como argumento. */
const COMANDOS_UNA_PLACA = new Set([
  'ASIGNAR',
  'LLEGADA',
  'AUTORIZAR_SALIDA',
  'SALIDA',
  'APAGAR_ALARMA',
]);

const NOMBRES: Record<TipoToken, string> = {
  COMANDO: 'un comando',
  TIPO_VEHICULO: 'un tipo de vehiculo',
  PLACA: 'una placa',
  PAR_IZQ: "'('",
  PAR_DER: "')'",
  COMA: "','",
  PUNTO_COMA: "';'",
  EOF: 'el final del archivo',
};

/** Excepcion interna: solo viaja hasta el modo panico, nunca sale del parser. */
class FalloSintactico extends Error {}

export class Parser {
  private tokens: Token[];
  private pos = 0;
  private instrucciones: Instruccion[] = [];
  private errores: ErrorSintactico[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  /** <programa> -> <instruccion> <programa> | epsilon */
  analizar(): ResultadoSintactico {
    while (!this.esFin()) {
      try {
        this.instrucciones.push(this.instruccion());
      } catch (e) {
        if (!(e instanceof FalloSintactico)) throw e;
        this.recuperar();
      }
    }
    return { programa: { instrucciones: this.instrucciones }, errores: this.errores };
  }

  /** <instruccion> -> <comando> ';' */
  private instruccion(): Instruccion {
    const instr = this.comando();
    this.consumir('PUNTO_COMA', "Falta ';' al final de la instruccion");
    return instr;
  }

  /** <comando> -> ... (siete alternativas, todas distinguibles por el primer token) */
  private comando(): Instruccion {
    const tk = this.consumir('COMANDO', 'Se esperaba un comando');
    const { linea, columna } = tk;
    const nombre = tk.valor;

    if (nombre === 'CONSULTAR') {
      this.consumir('PAR_IZQ', "Se esperaba '(' despues de CONSULTAR");
      this.consumir('PAR_DER', 'CONSULTAR no recibe argumentos');
      return { comando: 'CONSULTAR', linea, columna };
    }

    if (nombre === 'REGISTRAR') {
      this.consumir('PAR_IZQ', "Se esperaba '(' despues de REGISTRAR");
      const tipo = this.consumir(
        'TIPO_VEHICULO',
        'El primer argumento de REGISTRAR debe ser un tipo de vehiculo (compacto, grande, moto o carga)'
      );
      this.consumir('COMA', "Se esperaba ',' entre el tipo y la placa");
      const placa = this.consumir('PLACA', 'El segundo argumento de REGISTRAR debe ser una placa');
      this.consumir('PAR_DER', "Se esperaba ')' para cerrar REGISTRAR");
      return {
        comando: 'REGISTRAR',
        tipoVehiculo: tipo.valor,
        placa: placa.valor,
        linea,
        columna,
      };
    }

    if (COMANDOS_UNA_PLACA.has(nombre)) {
      this.consumir('PAR_IZQ', `Se esperaba '(' despues de ${nombre}`);
      const placa = this.consumir('PLACA', `${nombre} recibe una placa como argumento`);
      this.consumir('PAR_DER', `Se esperaba ')' para cerrar ${nombre}`);
      return { comando: nombre, placa: placa.valor, linea, columna } as Instruccion;
    }

    // Inalcanzable si el lexer y esta lista estan sincronizados.
    throw this.fallo(`Comando '${nombre}' no implementado en el parser`, tk);
  }

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------

  private consumir(tipo: TipoToken, mensaje: string): Token {
    const tk = this.actual();
    if (tk.tipo !== tipo) {
      throw this.fallo(`${mensaje}. Se encontro ${this.describir(tk)}`, tk);
    }
    this.pos++;
    return tk;
  }

  private describir(tk: Token): string {
    if (tk.tipo === 'EOF') return 'el final del archivo';
    return `'${tk.lexema}' (${NOMBRES[tk.tipo]})`;
  }

  private fallo(mensaje: string, tk: Token): FalloSintactico {
    this.errores.push({
      clase: 'ERROR_SINTACTICO',
      mensaje,
      lexema: tk.lexema,
      linea: tk.linea,
      columna: tk.columna,
    });
    return new FalloSintactico(mensaje);
  }

  /** Modo panico: descarta tokens hasta pasar el siguiente ';'. */
  private recuperar(): void {
    while (!this.esFin()) {
      const tk = this.tokens[this.pos++];
      if (tk.tipo === 'PUNTO_COMA') return;
    }
  }

  private actual(): Token {
    return this.tokens[this.pos];
  }

  private esFin(): boolean {
    return this.actual().tipo === 'EOF';
  }
}
