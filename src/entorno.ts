/**
 * Carga backend/.env (si existe) antes que cualquier otro módulo: debe ser
 * el PRIMER import de servidor.ts, porque db.ts lee RUTA_BD al importarse.
 * Las variables ya definidas en la terminal tienen prioridad sobre el .env.
 */
try {
  process.loadEnvFile?.();
} catch {
  // Sin .env: se usan los valores por defecto (modo simulador, puerto 8080).
}
