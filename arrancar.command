#!/bin/bash
# Tablón de Anuncios Westmarch — script de arranque
# Doble clic para lanzar el servidor y abrir el navegador.

cd "$(dirname "$0")"
echo "Arrancando el Tablón de Anuncios..."
node server.js &
SERVER_PID=$!
sleep 1
open http://127.0.0.1:4173
echo "Servidor en http://127.0.0.1:4173 (PID $SERVER_PID)"
echo "Cierra esta ventana para apagar el servidor."
wait $SERVER_PID
