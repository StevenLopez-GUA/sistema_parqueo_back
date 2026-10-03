/**
 * PROTOCOLO SERIAL PC <-> ARDUINO MEGA
 *
 * Tramas de texto plano terminadas en '\n'. El indice que viaja en la
 * trama es espacio.indice_led (00..09), que es el mismo numero que
 * identifica al sensor y al LED de ese espacio en la maqueta.
 *
 * ARDUINO -> PC
 *   SENS:04:1     el sensor del espacio con indice 4 detecta vehiculo
 *   SENS:04:0     el espacio con indice 4 quedo vacio
 *   BTN:AUTH      se presiono el boton fisico de autorizacion
 *   MOV:1         el PIR detecto movimiento en el area
 *   LISTO         el Arduino termino de arrancar
 *
 * PC -> ARDUINO
 *   LED:04:ROJO   pinta el LED del espacio con indice 4
 *   ALARMA:ON     enciende buzzer y LED de alarma
 *   ALARMA:OFF    los apaga
 *   SYNC          pide el estado de los 10 sensores
 */

export type Color = 'VERDE' | 'AMARILLO' | 'ROJO' | 'AZUL' | 'APAGADO';

export type EstadoEspacio =
  | 'LIBRE'
  | 'ASIGNADO'
  | 'OCUPADO'
  | 'AUTORIZADO'
  | 'ALARMA'
  | 'FUERA_SERVICIO';

/** Color del LED segun el estado del espacio. Unica fuente de verdad. */
export const COLOR_POR_ESTADO: Record<EstadoEspacio, Color> = {
  LIBRE: 'VERDE',
  ASIGNADO: 'AMARILLO',
  OCUPADO: 'ROJO',
  AUTORIZADO: 'AZUL',
  ALARMA: 'ROJO', // el parpadeo lo maneja el firmware con ALARMA:ON
  FUERA_SERVICIO: 'APAGADO',
};

export type TramaEntrante =
  | { tipo: 'SENSOR'; indice: number; ocupado: boolean }
  | { tipo: 'BOTON' }
  | { tipo: 'MOVIMIENTO'; activo: boolean }
  | { tipo: 'LISTO' }
  | { tipo: 'DESCONOCIDA'; texto: string };

const dos = (n: number) => String(n).padStart(2, '0');

export const tramaLed = (indice: number, color: Color) => `LED:${dos(indice)}:${color}`;
export const tramaAlarma = (encendida: boolean) => `ALARMA:${encendida ? 'ON' : 'OFF'}`;
export const tramaSync = () => 'SYNC';

export function decodificar(linea: string): TramaEntrante {
  const texto = linea.trim();
  if (!texto) return { tipo: 'DESCONOCIDA', texto };

  const partes = texto.split(':');

  if (partes[0] === 'SENS' && partes.length === 3) {
    const indice = Number(partes[1]);
    const valor = partes[2];
    if (Number.isInteger(indice) && (valor === '0' || valor === '1')) {
      return { tipo: 'SENSOR', indice, ocupado: valor === '1' };
    }
  }

  if (partes[0] === 'BTN' && partes[1] === 'AUTH') return { tipo: 'BOTON' };

  if (partes[0] === 'MOV' && partes.length === 2) {
    return { tipo: 'MOVIMIENTO', activo: partes[1] === '1' };
  }

  if (texto === 'LISTO') return { tipo: 'LISTO' };

  return { tipo: 'DESCONOCIDA', texto };
}
