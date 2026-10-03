/**
 * SERVICIO DEL PARQUEO
 *
 * Implementa el automata de estados de cada espacio:
 *
 *   LIBRE --ASIGNAR--> ASIGNADO --LLEGADA--> OCUPADO
 *     ^                                        |
 *     |                             AUTORIZAR_SALIDA
 *     |                                        v
 *     +--------------SALIDA--------------- AUTORIZADO
 *
 *   OCUPADO --(sensor se libera sin autorizacion)--> ALARMA
 *   ALARMA  --APAGAR_ALARMA--> OCUPADO o LIBRE
 *
 * Toda mutacion pasa por aqui. Ni el interprete ni la API tocan la BD.
 */

import { db } from '../db/db.js';
import {
  COLOR_POR_ESTADO,
  tramaAlarma,
  tramaLed,
  type EstadoEspacio,
} from '../hardware/protocolo.js';
import type { Transporte } from '../hardware/transporte.js';

export interface FilaEstado {
  espacio_id: number;
  espacio: string;
  tipo_espacio: string;
  estado: EstadoEspacio;
  indice_led: number;
  sensor_ocupado: number;
  placa: string | null;
  tipo_vehiculo: string | null;
  ocupacion_id: number | null;
  llegada_en: string | null;
  autorizado_en: string | null;
  en_alarma: number;
}

export interface Evento {
  momento: string;
  texto: string;
  nivel: 'info' | 'alarma' | 'error';
}

export class ServicioParqueo {
  private oyentes: (() => void)[] = [];
  private eventos: Evento[] = [];
  /** Espacio seleccionado en la consola; el boton fisico actua sobre este. */
  espacioSeleccionado: number | null = null;

  constructor(private hardware: Transporte) {}

  // ==================================================================
  // Consultas
  // ==================================================================

  estado(): FilaEstado[] {
    return db.prepare('SELECT * FROM v_estado_parqueo ORDER BY espacio').all() as FilaEstado[];
  }

  disponibilidad() {
    return db.prepare('SELECT * FROM v_disponibilidad ORDER BY tipo_espacio').all();
  }

  bitacora(limite = 60) {
    return db
      .prepare('SELECT * FROM bitacora ORDER BY id DESC LIMIT ?')
      .all(limite);
  }

  ultimosEventos(): Evento[] {
    return this.eventos.slice(-60);
  }

  // ==================================================================
  // Comandos del lenguaje
  // ==================================================================

  registrar(tipoVehiculo: string, placa: string): string {
    const tipo = db
      .prepare('SELECT id FROM tipo_vehiculo WHERE codigo = ?')
      .get(tipoVehiculo) as { id: number };

    const existente = db.prepare('SELECT id FROM vehiculo WHERE placa = ?').get(placa) as
      | { id: number }
      | undefined;

    if (existente) {
      db.prepare('UPDATE vehiculo SET tipo_vehiculo_id = ? WHERE id = ?').run(
        tipo.id,
        existente.id
      );
    } else {
      db.prepare('INSERT INTO vehiculo (placa, tipo_vehiculo_id) VALUES (?, ?)').run(
        placa,
        tipo.id
      );
    }

    this.notificar();
    return `Vehiculo ${placa} registrado como ${tipoVehiculo}`;
  }

  /**
   * Asignacion automatica. Toda la logica vive en una sola consulta:
   * busca el espacio libre compatible de menor prioridad, respetando
   * las reservas.
   */
  asignar(placa: string): string {
    const espacio = this.mejorEspacioPara(placa);
    if (!espacio) throw new Error(`No hay espacio disponible para la placa ${placa}`);

    const vehiculo = this.vehiculoPorPlaca(placa)!;

    const tx = db.transaction(() => {
      db.prepare('INSERT INTO ocupacion (vehiculo_id, espacio_id) VALUES (?, ?)').run(
        vehiculo.id,
        espacio.id
      );
      this.cambiarEstadoEspacio(espacio.id, 'ASIGNADO');
    });
    tx();

    this.registrarEvento(`${placa} asignado al espacio ${espacio.codigo}`, 'info');
    this.notificar();
    return `Espacio ${espacio.codigo} asignado a ${placa}`;
  }

  llegada(placa: string): string {
    const oc = this.ocupacionViva(placa)!;
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE ocupacion
            SET estado = 'OCUPADO', llegada_en = datetime('now','localtime')
          WHERE id = ?`
      ).run(oc.ocupacion_id);
      this.cambiarEstadoEspacio(oc.espacio_id, 'OCUPADO');
    });
    tx();

    this.registrarEvento(`${placa} ocupo el espacio ${oc.espacio} — seguridad activa`, 'info');
    this.notificar();
    return `Llegada confirmada en ${oc.espacio}. Sistema de seguridad activado`;
  }

  autorizarSalida(placa: string): string {
    const oc = this.ocupacionViva(placa)!;
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE ocupacion
            SET estado = 'AUTORIZADO', autorizado_en = datetime('now','localtime')
          WHERE id = ?`
      ).run(oc.ocupacion_id);
      this.cambiarEstadoEspacio(oc.espacio_id, 'AUTORIZADO');
    });
    tx();

    this.registrarEvento(`Salida autorizada para ${placa} en ${oc.espacio}`, 'info');
    this.notificar();
    return `Salida autorizada para ${placa}. Ya puede retirar el vehiculo de ${oc.espacio}`;
  }

  salida(placa: string): string {
    const oc = this.ocupacionViva(placa)!;
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE ocupacion
            SET estado = 'FINALIZADA', salida_en = datetime('now','localtime')
          WHERE id = ?`
      ).run(oc.ocupacion_id);
      this.cambiarEstadoEspacio(oc.espacio_id, 'LIBRE');
    });
    tx();

    this.registrarEvento(`${placa} salio. ${oc.espacio} disponible`, 'info');
    this.notificar();
    return `Espacio ${oc.espacio} liberado`;
  }

  apagarAlarma(placa: string): string {
    const fila = this.alarmaActivaDePlaca(placa)!;

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE alarma
            SET apagada_en = datetime('now','localtime'), apagada_por = 'OPERADOR'
          WHERE id = ?`
      ).run(fila.alarma_id);

      // Si el sensor sigue vacio, el vehiculo efectivamente se fue:
      // cerramos la ocupacion marcandola como salida forzada.
      if (fila.sensor_ocupado === 0) {
        db.prepare(
          `UPDATE ocupacion
              SET estado = 'FINALIZADA',
                  salida_en = datetime('now','localtime'),
                  salida_forzada = 1
            WHERE id = ?`
        ).run(fila.ocupacion_id);
        this.cambiarEstadoEspacio(fila.espacio_id, 'LIBRE');
      } else {
        // Falsa alarma: el vehiculo sigue ahi.
        this.cambiarEstadoEspacio(fila.espacio_id, 'OCUPADO');
      }
    });
    tx();

    this.sincronizarSirena();
    this.registrarEvento(`Alarma de ${placa} desactivada por el operador`, 'info');
    this.notificar();

    return fila.sensor_ocupado === 0
      ? `Alarma apagada. ${fila.espacio} quedo libre (salida sin autorizacion registrada)`
      : `Alarma apagada. ${placa} sigue en ${fila.espacio}`;
  }

  consultar(): FilaEstado[] {
    return this.estado();
  }

  // ==================================================================
  // Eventos que vienen de la maqueta
  // ==================================================================

  /**
   * Llega una lectura de sensor. Aqui es donde nace la alarma:
   * comparamos lo que dice el hardware contra lo que dice el sistema.
   */
  alCambiarSensor(indice: number, ocupado: boolean): void {
    const espacio = db
      .prepare('SELECT id, codigo, estado FROM espacio WHERE indice_led = ?')
      .get(indice) as { id: number; codigo: string; estado: EstadoEspacio } | undefined;

    if (!espacio) return;

    db.prepare(
      `UPDATE espacio
          SET sensor_ocupado = ?, actualizado_en = datetime('now','localtime')
        WHERE id = ?`
    ).run(ocupado ? 1 : 0, espacio.id);

    // CASO 1: el vehiculo se movio sin que nadie autorizara la salida.
    if (!ocupado && espacio.estado === 'OCUPADO') {
      this.dispararAlarma(espacio.id, 'SALIDA_NO_AUTORIZADA');
    }

    // CASO 2: alguien se parqueo en un espacio que el sistema cree libre.
    if (ocupado && espacio.estado === 'LIBRE') {
      this.dispararAlarma(espacio.id, 'OCUPACION_NO_REGISTRADA');
    }

    this.notificar();
  }

  /** Boton fisico: autoriza la salida del espacio seleccionado en la consola. */
  alPresionarBoton(): string {
    if (this.espacioSeleccionado === null) {
      this.registrarEvento('Boton presionado sin espacio seleccionado', 'error');
      this.notificar();
      return 'No hay ningun espacio seleccionado en la consola';
    }

    const fila = this.estado().find((f) => f.espacio_id === this.espacioSeleccionado);
    if (!fila?.placa || fila.estado !== 'OCUPADO') {
      this.registrarEvento(`Boton presionado sobre ${fila?.espacio ?? '?'} sin vehiculo`, 'error');
      this.notificar();
      return 'El espacio seleccionado no tiene un vehiculo listo para salir';
    }

    return this.autorizarSalida(fila.placa);
  }

  alDetectarMovimiento(activo: boolean): void {
    if (!activo) return;
    const hayAlarmas = this.hayAlarmasActivas();
    if (hayAlarmas) this.registrarEvento('Movimiento detectado durante alarma activa', 'alarma');
  }

  // ==================================================================
  // Alarmas
  // ==================================================================

  private dispararAlarma(espacioId: number, motivo: string): void {
    const yaActiva = db
      .prepare('SELECT id FROM alarma WHERE espacio_id = ? AND apagada_en IS NULL')
      .get(espacioId);
    if (yaActiva) return;

    const oc = db
      .prepare(
        `SELECT o.id, v.placa
           FROM ocupacion o
           JOIN vehiculo v ON v.id = o.vehiculo_id
          WHERE o.espacio_id = ?
            AND o.estado IN ('ASIGNADO','OCUPADO','AUTORIZADO')`
      )
      .get(espacioId) as { id: number; placa: string } | undefined;

    db.prepare(
      'INSERT INTO alarma (ocupacion_id, espacio_id, motivo) VALUES (?, ?, ?)'
    ).run(oc?.id ?? null, espacioId, motivo);

    this.cambiarEstadoEspacio(espacioId, 'ALARMA');
    this.sincronizarSirena();

    const codigo = (
      db.prepare('SELECT codigo FROM espacio WHERE id = ?').get(espacioId) as { codigo: string }
    ).codigo;

    const quien = oc?.placa ? `vehiculo ${oc.placa}` : 'vehiculo no registrado';
    this.registrarEvento(`ALARMA en ${codigo}: ${quien} (${motivo})`, 'alarma');

    this.anotarBitacora({
      origen: 'SISTEMA',
      resultado: 'OK',
      mensaje: `Alarma disparada en ${codigo}: ${motivo}`,
      espacio_id: espacioId,
    });
  }

  private hayAlarmasActivas(): boolean {
    const r = db.prepare('SELECT COUNT(*) AS n FROM alarma WHERE apagada_en IS NULL').get() as {
      n: number;
    };
    return r.n > 0;
  }

  /** El buzzer suena mientras exista al menos una alarma sin apagar. */
  private sincronizarSirena(): void {
    this.hardware.enviar(tramaAlarma(this.hayAlarmasActivas()));
  }

  // ==================================================================
  // Utilidades internas
  // ==================================================================

  private cambiarEstadoEspacio(espacioId: number, estado: EstadoEspacio): void {
    db.prepare(
      `UPDATE espacio
          SET estado = ?, actualizado_en = datetime('now','localtime')
        WHERE id = ?`
    ).run(estado, espacioId);

    const e = db
      .prepare('SELECT indice_led FROM espacio WHERE id = ?')
      .get(espacioId) as { indice_led: number };

    this.hardware.enviar(tramaLed(e.indice_led, COLOR_POR_ESTADO[estado]));
  }

  /** Repinta los 10 LEDs. Se usa al conectar con la maqueta. */
  sincronizarTodosLosLeds(): void {
    for (const fila of this.estado()) {
      this.hardware.enviar(tramaLed(fila.indice_led, COLOR_POR_ESTADO[fila.estado]));
    }
    this.sincronizarSirena();
  }

  vehiculoPorPlaca(placa: string) {
    return db
      .prepare(
        `SELECT v.id, v.placa, tv.codigo AS tipo
           FROM vehiculo v
           JOIN tipo_vehiculo tv ON tv.id = v.tipo_vehiculo_id
          WHERE v.placa = ?`
      )
      .get(placa) as { id: number; placa: string; tipo: string } | undefined;
  }

  /** Ocupacion en curso (no finalizada) de una placa. */
  ocupacionViva(placa: string) {
    return db
      .prepare(
        `SELECT o.id AS ocupacion_id, o.estado, o.espacio_id,
                e.codigo AS espacio, e.sensor_ocupado
           FROM ocupacion o
           JOIN vehiculo v ON v.id = o.vehiculo_id
           JOIN espacio  e ON e.id = o.espacio_id
          WHERE v.placa = ?
            AND o.estado IN ('ASIGNADO','OCUPADO','AUTORIZADO')`
      )
      .get(placa) as
      | {
          ocupacion_id: number;
          estado: string;
          espacio_id: number;
          espacio: string;
          sensor_ocupado: number;
        }
      | undefined;
  }

  alarmaActivaDePlaca(placa: string) {
    return db
      .prepare(
        `SELECT a.id AS alarma_id, a.espacio_id, o.id AS ocupacion_id,
                e.codigo AS espacio, e.sensor_ocupado
           FROM alarma a
           JOIN espacio   e ON e.id = a.espacio_id
           JOIN ocupacion o ON o.id = a.ocupacion_id
           JOIN vehiculo  v ON v.id = o.vehiculo_id
          WHERE a.apagada_en IS NULL AND v.placa = ?`
      )
      .get(placa) as
      | {
          alarma_id: number;
          espacio_id: number;
          ocupacion_id: number;
          espacio: string;
          sensor_ocupado: number;
        }
      | undefined;
  }

  /** La consulta de asignacion automatica del enunciado, completa. */
  mejorEspacioPara(placa: string) {
    return db
      .prepare(
        `SELECT e.id, e.codigo, e.indice_led
           FROM espacio e
           JOIN tipo_espacio   te ON te.id = e.tipo_espacio_id
           JOIN compatibilidad c  ON c.tipo_espacio_id = e.tipo_espacio_id
           JOIN vehiculo       v  ON v.placa = ?
          WHERE e.estado = 'LIBRE'
            AND c.tipo_vehiculo_id = v.tipo_vehiculo_id
            AND (
                  te.requiere_reserva = 0
                  OR EXISTS (SELECT 1 FROM reserva r
                              WHERE r.espacio_id = e.id
                                AND r.activa = 1
                                AND r.placa = v.placa)
                )
          ORDER BY c.prioridad ASC, e.codigo ASC
          LIMIT 1`
      )
      .get(placa) as { id: number; codigo: string; indice_led: number } | undefined;
  }

  anotarBitacora(fila: {
    origen: 'INTERPRETE' | 'SENSOR' | 'SISTEMA';
    comando?: string | null;
    resultado: string;
    mensaje?: string | null;
    linea?: number | null;
    columna?: number | null;
    espacio_id?: number | null;
    vehiculo_id?: number | null;
  }): void {
    db.prepare(
      `INSERT INTO bitacora
         (origen, comando, resultado, mensaje, linea, columna, espacio_id, vehiculo_id)
       VALUES (@origen, @comando, @resultado, @mensaje, @linea, @columna, @espacio_id, @vehiculo_id)`
    ).run({
      origen: fila.origen,
      comando: fila.comando ?? null,
      resultado: fila.resultado,
      mensaje: fila.mensaje ?? null,
      linea: fila.linea ?? null,
      columna: fila.columna ?? null,
      espacio_id: fila.espacio_id ?? null,
      vehiculo_id: fila.vehiculo_id ?? null,
    });
  }

  registrarEvento(texto: string, nivel: Evento['nivel']): void {
    this.eventos.push({
      momento: new Date().toLocaleTimeString('es-GT'),
      texto,
      nivel,
    });
    if (this.eventos.length > 300) this.eventos.splice(0, 100);
  }

  alCambiar(cb: () => void): void {
    this.oyentes.push(cb);
  }

  private notificar(): void {
    this.oyentes.forEach((cb) => cb());
  }
}
