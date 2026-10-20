/**
 * ENDPOINT DEL ARDUINO R4 WIFI
 *
 * El Arduino postea aqui cada 2 segundos. La respuesta de este mismo
 * POST es el unico canal por el que recibe ordenes, asi que tiene que
 * contestar rapido y siempre con JSON valido: si devolvemos HTML de
 * error, el ArduinoJson del firmware falla y la talanquera se queda
 * sin instrucciones.
 */

import { Router } from 'express';
import type { TransporteHttp } from './transporte-http.js';

export function rutasArduino(transporte: TransporteHttp): Router {
  const r = Router();

  r.post('/v1/sensores', (req, res) => {
    try {
      const cuerpo = req.body ?? {};
      res.json(transporte.recibirEstado(cuerpo));
    } catch (e) {
      console.error('[arduino] error procesando el POST:', e);
      // Incluso al fallar hay que responder JSON valido y seguro.
      res.status(200).json({
        entra: 0,
        semaforo: 'ROJO',
        alarma: false,
        mensaje: 'Error en el servidor',
      });
    }
  });

  /** Diagnostico del enlace, para la interfaz y para depurar en el salon. */
  r.get('/v1/maqueta', (_req, res) => {
    res.json(transporte.diagnostico());
  });

  /** Abrir la talanquera a mano, sin pasar por el lenguaje. */
  r.post('/v1/paso', (req, res) => {
    transporte.abrirPaso(String(req.body?.mensaje ?? 'Paso manual del operador'));
    res.json({ ok: true });
  });

  return r;
}
