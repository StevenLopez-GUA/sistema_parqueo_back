/**
 * TRANSPORTE HACIA LA MAQUETA
 *
 * El backend nunca habla con el puerto serial directamente: habla con
 * esta interfaz. Eso permite intercambiar el Arduino real por un
 * simulador sin tocar una sola linea de logica de negocio.
 *
 * Se elige con la variable de entorno MODO_HARDWARE=serial|simulador
 */

import { decodificar, tramaSync, type TramaEntrante } from './protocolo.js';
import { TransporteHttp } from './transporte-http.js';

export interface Transporte {
  readonly modo: 'serial' | 'simulador' | 'http';
  conectar(): Promise<void>;
  enviar(trama: string): void;
  alRecibir(manejador: (t: TramaEntrante) => void): void;
  /** Solo tiene efecto en el simulador. */
  moverVehiculo?(indice: number, presente: boolean): void;
  presionarBoton?(): void;
  /** Solo existe en maquetas con talanquera (transporte http). */
  abrirPaso?(mensaje?: string): void;
  cerrarPaso?(): void;
}

// =====================================================================
// Arduino real por puerto serial
// =====================================================================

export class ArduinoSerial implements Transporte {
  readonly modo = 'serial' as const;
  private puerto: any;
  private manejadores: ((t: TramaEntrante) => void)[] = [];

  constructor(
    private ruta: string,
    private baudios = 115200
  ) {}

  async conectar(): Promise<void> {
    // Import dinamico: si no hay hardware, ni siquiera se carga serialport.
    const { SerialPort } = await import('serialport');
    const { ReadlineParser } = await import('@serialport/parser-readline');

    this.puerto = new SerialPort({ path: this.ruta, baudRate: this.baudios });
    const parser = this.puerto.pipe(new ReadlineParser({ delimiter: '\n' }));

    parser.on('data', (linea: string) => {
      const trama = decodificar(linea);
      this.manejadores.forEach((m) => m(trama));
    });

    this.puerto.on('error', (e: Error) => console.error('[serial] error:', e.message));

    await new Promise<void>((res) => this.puerto.on('open', () => res()));
    console.log(`[serial] conectado a ${this.ruta} @ ${this.baudios}`);

    // El Mega se reinicia al abrir el puerto. Esperamos y pedimos estado.
    setTimeout(() => this.enviar(tramaSync()), 2500);
  }

  enviar(trama: string): void {
    if (!this.puerto?.isOpen) return;
    this.puerto.write(trama + '\n');
  }

  alRecibir(manejador: (t: TramaEntrante) => void): void {
    this.manejadores.push(manejador);
  }
}

// =====================================================================
// Simulador: un Arduino de mentira, en memoria
// =====================================================================

export class SimuladorArduino implements Transporte {
  readonly modo = 'simulador' as const;
  private manejadores: ((t: TramaEntrante) => void)[] = [];
  private sensores: boolean[];
  /** Ultimo estado que la PC mando pintar. Solo para inspeccion desde la UI. */
  readonly leds: string[];
  alarmaEncendida = false;

  constructor(private cantidadEspacios = 10) {
    this.sensores = new Array(cantidadEspacios).fill(false);
    this.leds = new Array(cantidadEspacios).fill('VERDE');
  }

  async conectar(): Promise<void> {
    console.log('[simulador] activo: no se necesita hardware fisico');
    setTimeout(() => this.emitir({ tipo: 'LISTO' }), 100);
  }

  enviar(trama: string): void {
    const p = trama.trim().split(':');

    if (p[0] === 'LED' && p.length === 3) {
      this.leds[Number(p[1])] = p[2];
      return;
    }
    if (p[0] === 'ALARMA') {
      this.alarmaEncendida = p[1] === 'ON';
      return;
    }
    if (p[0] === 'SYNC') {
      this.sensores.forEach((ocupado, indice) =>
        this.emitir({ tipo: 'SENSOR', indice, ocupado })
      );
      return;
    }
  }

  alRecibir(manejador: (t: TramaEntrante) => void): void {
    this.manejadores.push(manejador);
  }

  /** Simula que un carrito entra o sale de un espacio de la maqueta. */
  moverVehiculo(indice: number, presente: boolean): void {
    if (indice < 0 || indice >= this.cantidadEspacios) return;
    if (this.sensores[indice] === presente) return;
    this.sensores[indice] = presente;
    this.emitir({ tipo: 'SENSOR', indice, ocupado: presente });
  }

  presionarBoton(): void {
    this.emitir({ tipo: 'BOTON' });
  }

  private emitir(t: TramaEntrante): void {
    this.manejadores.forEach((m) => m(t));
  }
}

export function crearTransporte(): Transporte {
  const modo = process.env.MODO_HARDWARE ?? 'simulador';

  if (modo === 'serial') {
    const ruta = process.env.PUERTO_SERIAL ?? '/dev/ttyACM0';
    const baudios = Number(process.env.BAUDIOS ?? 115200);
    return new ArduinoSerial(ruta, baudios);
  }

  // Maqueta real del grupo: Arduino R4 WiFi que postea por HTTP.
  if (modo === 'http') {
    return new TransporteHttp();
  }

  return new SimuladorArduino(Number(process.env.ESPACIOS ?? 10));
}
