/**
 * TRANSPORTE HTTP — Arduino R4 WiFi
 *
 * El Arduino de la maqueta no se conecta por serial: cada 2 segundos
 * hace POST /api/v1/sensores con el estado de los sensores, y lee las
 * ordenes del sistema en el CUERPO DE LA RESPUESTA de ese mismo POST.
 *
 * Eso invierte la direccion respecto al transporte serial:
 *
 *   Serial:  la PC empuja ordenes cuando quiere.
 *   HTTP:    la PC deja las ordenes en una bandeja, y el Arduino las
 *            recoge en su siguiente POST.
 *
 * Esta clase implementa la misma interfaz Transporte que el resto del
 * sistema ya usa, de modo que el servicio, el interprete y la base de
 * datos no se enteran del cambio.
 *
 * FORMATO QUE ENVIA EL ARDUINO
 *   { "carga": true, "privado1": false, "privado2": false,
 *     "libre1": false, "libre2": false, "talanquera": true }
 *
 *   true = hay presencia. Los FC-51 dan LOW al detectar, y el firmware
 *   ya hace esa inversion antes de armar el JSON.
 *
 * FORMATO QUE DEVUELVE EL SISTEMA
 *   { "entra": 1, "semaforo": "VERDE", "alarma": false,
 *     "mensaje": "Ingrese al espacio P3" }
 */

import { decodificar, type TramaEntrante } from './protocolo.js';
import type { Transporte } from './transporte.js';

/**
 * Cuanto tiempo se mantiene abierto el permiso de paso. Al salir, cubre
 * el trayecto desde que se autoriza hasta que el vehiculo cruza la barrera.
 */
const VENTANA_PASO_MS = 60_000;

export type Semaforo = 'VERDE' | 'AMARILLO' | 'ROJO';

export interface RespuestaArduino {
  entra: 0 | 1;
  semaforo: Semaforo;
  alarma: boolean;
  mensaje: string;
}

export class TransporteHttp implements Transporte {
  readonly modo = 'http' as const;

  private manejadores: ((t: TramaEntrante) => void)[] = [];

  /** Ultimo valor conocido por clave de sensor, para emitir solo cambios. */
  private ultimoEstado = new Map<string, boolean>();

  /** Color que la PC ordeno para cada indice. El Arduino puede ignorarlo. */
  private colores = new Map<number, string>();

  private alarmaActiva = false;
  private pasoHasta = 0;
  private mensajePaso = '';
  private vehiculoEnTalanquera = false;

  /** millis del ultimo POST recibido. Sirve para saber si la maqueta vive. */
  ultimoContacto: number | null = null;

  /**
   * Mapa clave del JSON -> indice_led del espacio.
   * Debe coincidir con la columna clave_sensor de la tabla espacio.
   */
  constructor(
    private mapaSensores: Record<string, number> = {
      carga: 0,
      privado1: 1,
      privado2: 2,
      libre1: 3,
      libre2: 4,
    }
  ) {}

  async conectar(): Promise<void> {
    console.log('[http] esperando POST del Arduino en /api/v1/sensores');
  }

  /**
   * El resto del sistema llama a esto creyendo que manda una trama serial.
   * Aqui no se envia nada: se guarda para la proxima respuesta HTTP.
   */
  enviar(trama: string): void {
    const p = trama.trim().split(':');

    if (p[0] === 'LED' && p.length === 3) {
      this.colores.set(Number(p[1]), p[2]);
      return;
    }
    if (p[0] === 'ALARMA') {
      this.alarmaActiva = p[1] === 'ON';
      return;
    }
    // SYNC no aplica: el Arduino manda el estado completo en cada POST.
  }

  alRecibir(manejador: (t: TramaEntrante) => void): void {
    this.manejadores.push(manejador);
  }

  // ------------------------------------------------------------------
  // Permiso de paso (talanquera + semaforo)
  // ------------------------------------------------------------------

  /**
   * Abre la talanquera. El permiso se mantiene hasta que el vehiculo
   * cruza (el ultrasonico deja de detectarlo) o hasta que vence la
   * ventana, lo que ocurra primero.
   */
  abrirPaso(mensaje = 'Paso autorizado'): void {
    this.pasoHasta = Date.now() + VENTANA_PASO_MS;
    this.mensajePaso = mensaje;
    console.log(`[http] paso autorizado: ${mensaje}`);
  }

  cerrarPaso(): void {
    this.pasoHasta = 0;
    this.mensajePaso = '';
  }

  private pasoAbierto(): boolean {
    return Date.now() < this.pasoHasta;
  }

  // ------------------------------------------------------------------
  // Entrada: el POST del Arduino
  // ------------------------------------------------------------------

  /**
   * Procesa el cuerpo del POST y devuelve las ordenes pendientes.
   * Solo emite eventos de sensor cuando el valor CAMBIA, para no
   * inundar el sistema con 5 eventos cada 2 segundos.
   */
  recibirEstado(cuerpo: Record<string, unknown>): RespuestaArduino {
    this.ultimoContacto = Date.now();

    for (const [clave, indice] of Object.entries(this.mapaSensores)) {
      if (!(clave in cuerpo)) continue;

      const ocupado = cuerpo[clave] === true || cuerpo[clave] === 'true';
      if (this.ultimoEstado.get(clave) === ocupado) continue;

      this.ultimoEstado.set(clave, ocupado);
      this.emitir({ tipo: 'SENSOR', indice, ocupado });
    }

    // --- Talanquera: el ultrasonico de la entrada ---
    if ('talanquera' in cuerpo) {
      const hayVehiculo = cuerpo.talanquera === true || cuerpo.talanquera === 'true';

      // El vehiculo cruzo: se consume el permiso para que no reabra sola.
      if (this.vehiculoEnTalanquera && !hayVehiculo && this.pasoAbierto()) {
        this.cerrarPaso();
        console.log('[http] el vehiculo cruzo, permiso consumido');
      }
      this.vehiculoEnTalanquera = hayVehiculo;
    }

    return this.ordenesPendientes();
  }

  private ordenesPendientes(): RespuestaArduino {
    const abierto = this.pasoAbierto();

    const semaforo: Semaforo = this.alarmaActiva
      ? 'AMARILLO'
      : abierto
        ? 'VERDE'
        : 'ROJO';

    return {
      entra: abierto ? 1 : 0,
      semaforo,
      alarma: this.alarmaActiva,
      mensaje: abierto
        ? this.mensajePaso
        : this.alarmaActiva
          ? 'ALARMA ACTIVA'
          : 'Esperando autorizacion',
    };
  }

  /** Para el panel de diagnostico de la interfaz. */
  diagnostico() {
    return {
      modo: this.modo,
      ultimoContacto: this.ultimoContacto,
      enLinea: this.ultimoContacto !== null && Date.now() - this.ultimoContacto < 8000,
      pasoAbierto: this.pasoAbierto(),
      vehiculoEnTalanquera: this.vehiculoEnTalanquera,
      alarmaActiva: this.alarmaActiva,
      colores: Object.fromEntries(this.colores),
    };
  }

  private emitir(t: TramaEntrante): void {
    this.manejadores.forEach((m) => m(t));
  }
}

/** Ayuda para pruebas: decodifica una trama como si viniera del serial. */
export const comoTrama = decodificar;
