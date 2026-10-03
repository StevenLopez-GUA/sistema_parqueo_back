/**
 * SERVIDOR
 * Express para la API + WebSocket para empujar el estado del parqueo
 * a la interfaz sin que el navegador tenga que estar preguntando.
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

import { reiniciarParqueo } from './db/db.js';
import { ServicioParqueo } from './parqueo/servicio.js';
import { Interprete } from './lenguaje/interprete.js';
import { crearTransporte, SimuladorArduino } from './hardware/transporte.js';

const PUERTO = Number(process.env.PUERTO ?? 3001);

const hardware = crearTransporte();
const servicio = new ServicioParqueo(hardware);
const interprete = new Interprete(servicio);

// ---------------------------------------------------------------------
// Tramas que llegan desde la maqueta
// ---------------------------------------------------------------------

hardware.alRecibir((trama) => {
  switch (trama.tipo) {
    case 'SENSOR':
      servicio.alCambiarSensor(trama.indice, trama.ocupado);
      break;
    case 'BOTON':
      servicio.alPresionarBoton();
      break;
    case 'MOVIMIENTO':
      servicio.alDetectarMovimiento(trama.activo);
      break;
    case 'LISTO':
      console.log('[hardware] maqueta lista, sincronizando LEDs');
      servicio.sincronizarTodosLosLeds();
      break;
    case 'DESCONOCIDA':
      if (trama.texto) console.warn('[hardware] trama no reconocida:', trama.texto);
      break;
  }
});

await hardware.conectar();

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/estado', (_req, res) => {
  res.json({
    espacios: servicio.estado(),
    disponibilidad: servicio.disponibilidad(),
    eventos: servicio.ultimosEventos(),
    modo: hardware.modo,
    seleccionado: servicio.espacioSeleccionado,
  });
});

/** Corre el intérprete sobre el código que escribió el operador. */
app.post('/api/ejecutar', (req, res) => {
  const codigo = String(req.body?.codigo ?? '');
  const resultado = interprete.ejecutar(codigo);
  difundir();
  res.json(resultado);
});

app.get('/api/bitacora', (_req, res) => {
  res.json(servicio.bitacora(Number(process.env.LIMITE_BITACORA ?? 60)));
});

/** Marca el espacio sobre el que actúa el botón físico de autorización. */
app.post('/api/seleccionar', (req, res) => {
  const id = req.body?.espacio_id;
  servicio.espacioSeleccionado = id === null || id === undefined ? null : Number(id);
  difundir();
  res.json({ seleccionado: servicio.espacioSeleccionado });
});

app.post('/api/reiniciar', (_req, res) => {
  reiniciarParqueo();
  servicio.sincronizarTodosLosLeds();
  servicio.registrarEvento('Parqueo reiniciado', 'info');
  difundir();
  res.json({ ok: true });
});

// --- Controles del simulador (no existen con hardware real) ---

app.post('/api/simulador/sensor', (req, res) => {
  if (!(hardware instanceof SimuladorArduino)) {
    return res.status(409).json({ error: 'El backend esta conectado a hardware real' });
  }
  hardware.moverVehiculo(Number(req.body?.indice), Boolean(req.body?.presente));
  difundir();
  res.json({ ok: true });
});

app.post('/api/simulador/boton', (_req, res) => {
  if (!(hardware instanceof SimuladorArduino)) {
    return res.status(409).json({ error: 'El backend esta conectado a hardware real' });
  }
  hardware.presionarBoton();
  difundir();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------

const servidor = createServer(app);
const wss = new WebSocketServer({ server: servidor });

function difundir(): void {
  const carga = JSON.stringify({
    espacios: servicio.estado(),
    disponibilidad: servicio.disponibilidad(),
    eventos: servicio.ultimosEventos(),
    modo: hardware.modo,
    seleccionado: servicio.espacioSeleccionado,
  });
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(carga);
  });
}

// Cualquier cambio de estado en el servicio se empuja al navegador.
servicio.alCambiar(difundir);

wss.on('connection', (ws) => {
  ws.send(
    JSON.stringify({
      espacios: servicio.estado(),
      disponibilidad: servicio.disponibilidad(),
      eventos: servicio.ultimosEventos(),
      modo: hardware.modo,
      seleccionado: servicio.espacioSeleccionado,
    })
  );
});

servidor.listen(PUERTO, () => {
  console.log(`[servidor] escuchando en http://localhost:${PUERTO}`);
  console.log(`[servidor] modo hardware: ${hardware.modo}`);
  servicio.sincronizarTodosLosLeds();
});
