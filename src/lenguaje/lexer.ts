/**
 * ANALIZADOR LEXICO
 * Curso: Automatas y Lenguajes Formales
 *
 * Convierte el codigo fuente en una lista de tokens.
 * Implementado a mano como un automata finito determinista: leemos
 * caracter por caracter, sin librerias de expresiones regulares en el
 * bucle principal, para poder sustentar el AFD en la documentacion.
 *
 * ALFABETO
 *   Sigma = { A-Z, a-z, 0-9, '(', ')', ',', ';', '_', '#',
 *             espacio, tabulacion, salto de linea }
 *
 * EXPRESIONES REGULARES DE LOS TOKENS
 *   COMANDO       -> REGISTRAR | ASIGNAR | LLEGADA | AUTORIZAR_SALIDA
 *                  | SALIDA | APAGAR_ALARMA | CONSULTAR
 *   TIPO_VEHICULO -> compacto | grande | moto | carga
 *   PLACA         -> [A-Z][0-9]{3}[A-Z]{3}
 *   PAR_IZQ       -> \(
 *   PAR_DER       -> \)
 *   COMA          -> ,
 *   PUNTO_COMA    -> ;
 *   COMENTARIO    -> #[^\n]*          (se descarta)
 *   ESPACIO       -> [ \t\r\n]+       (se descarta)
 */

export type TipoToken =
  | 'COMANDO'
  | 'TIPO_VEHICULO'
  | 'PLACA'
  | 'PAR_IZQ'
  | 'PAR_DER'
  | 'COMA'
  | 'PUNTO_COMA'
  | 'EOF';

export interface Token {
  tipo: TipoToken;
  lexema: string;
  /** valor ya normalizado: comandos en MAYUSCULA, tipos en minuscula */
  valor: string;
  linea: number;
  columna: number;
}

export interface ErrorLexico {
  clase: 'ERROR_LEXICO';
  mensaje: string;
  lexema: string;
  linea: number;
  columna: number;
}

export interface ResultadoLexico {
  tokens: Token[];
  errores: ErrorLexico[];
}

/** Palabras reservadas del lenguaje (comandos del enunciado). */
export const COMANDOS = new Set([
  'REGISTRAR',
  'ASIGNAR',
  'LLEGADA',
  'AUTORIZAR_SALIDA',
  'SALIDA',
  'APAGAR_ALARMA',
  'CONSULTAR',
]);

/** Tipos de vehiculo validos. Deben coincidir con tipo_vehiculo.codigo en la BD. */
export const TIPOS_VEHICULO = new Set(['compacto', 'grande', 'moto', 'carga']);

/** Formato de placa de Guatemala: P123ABC */
const PATRON_PLACA = /^[A-Z][0-9]{3}[A-Z]{3}$/;

const esLetra = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const esDigito = (c: string) => c >= '0' && c <= '9';
const esAlfanumerico = (c: string) => esLetra(c) || esDigito(c) || c === '_';

export class Lexer {
  private fuente: string;
  private pos = 0;
  private linea = 1;
  private columna = 1;
  private tokens: Token[] = [];
  private errores: ErrorLexico[] = [];

  constructor(fuente: string) {
    this.fuente = fuente;
  }

  analizar(): ResultadoLexico {
    while (!this.fin()) {
      const c = this.actual();

      // --- Estado: espacios en blanco (se descartan) ---
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        this.avanzar();
        continue;
      }

      // --- Estado: comentario de linea ---
      if (c === '#') {
        while (!this.fin() && this.actual() !== '\n') this.avanzar();
        continue;
      }

      // --- Estado: simbolos de un solo caracter ---
      const simple = this.simbolo(c);
      if (simple) {
        this.agregar(simple, c, c);
        this.avanzar();
        continue;
      }

      // --- Estado: palabra (comando, tipo o placa) ---
      if (esAlfanumerico(c)) {
        this.leerPalabra();
        continue;
      }

      // --- Estado de error: caracter fuera del alfabeto ---
      this.error(
        `El caracter '${c}' no pertenece al alfabeto del lenguaje`,
        c,
        this.linea,
        this.columna
      );
      this.avanzar();
    }

    this.tokens.push({
      tipo: 'EOF',
      lexema: '',
      valor: '',
      linea: this.linea,
      columna: this.columna,
    });

    return { tokens: this.tokens, errores: this.errores };
  }

  /**
   * Lee una secuencia alfanumerica completa y la clasifica.
   * El orden importa: comando -> tipo -> placa -> error.
   */
  private leerPalabra(): void {
    const linea = this.linea;
    const columna = this.columna;
    let lexema = '';

    while (!this.fin() && esAlfanumerico(this.actual())) {
      lexema += this.actual();
      this.avanzar();
    }

    const mayus = lexema.toUpperCase();
    const minus = lexema.toLowerCase();

    if (COMANDOS.has(mayus)) {
      this.agregar('COMANDO', lexema, mayus, linea, columna);
      return;
    }

    if (TIPOS_VEHICULO.has(minus)) {
      this.agregar('TIPO_VEHICULO', lexema, minus, linea, columna);
      return;
    }

    if (PATRON_PLACA.test(mayus)) {
      this.agregar('PLACA', lexema, mayus, linea, columna);
      return;
    }

    // Mensaje de error especifico: ayuda mucho en la demostracion.
    let pista = '';
    if (/^[A-Za-z]+$/.test(lexema)) {
      pista = ' Se esperaba un comando o un tipo de vehiculo.';
    } else if (/^[A-Za-z][0-9]/.test(lexema)) {
      pista = ' Si es una placa, debe tener el formato P123ABC.';
    }

    this.error(`'${lexema}' no es un simbolo valido del lenguaje.${pista}`, lexema, linea, columna);
  }

  private simbolo(c: string): TipoToken | null {
    switch (c) {
      case '(':
        return 'PAR_IZQ';
      case ')':
        return 'PAR_DER';
      case ',':
        return 'COMA';
      case ';':
        return 'PUNTO_COMA';
      default:
        return null;
    }
  }

  private agregar(
    tipo: TipoToken,
    lexema: string,
    valor: string,
    linea = this.linea,
    columna = this.columna
  ): void {
    this.tokens.push({ tipo, lexema, valor, linea, columna });
  }

  private error(mensaje: string, lexema: string, linea: number, columna: number): void {
    this.errores.push({ clase: 'ERROR_LEXICO', mensaje, lexema, linea, columna });
  }

  private fin(): boolean {
    return this.pos >= this.fuente.length;
  }

  private actual(): string {
    return this.fuente[this.pos];
  }

  private avanzar(): void {
    if (this.fuente[this.pos] === '\n') {
      this.linea++;
      this.columna = 1;
    } else {
      this.columna++;
    }
    this.pos++;
  }
}
