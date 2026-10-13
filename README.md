# Vaso Caliente

Juego multijugador tipo papa caliente. Un vaso de ácido pasa de celular en celular
y en algún momento explota. El que lo tiene en la mano queda afuera.

## Cómo se juega

- La presentadora abre **/host** en la computadora que se proyecta y toca **Crear partida**.
- Los jugadores entran desde el celular escaneando el código QR o con la dirección y el PIN.
- Al entrar, cada jugador pone su nombre y elige su personaje (los que ya eligió otro aparecen apagados).
- Los nombres con malas palabras comunes se rechazan solos.
- La admin puede tocar a cualquier jugador (en la sala de espera o durante el juego) para **bannearlo** (no puede volver a entrar desde ese celular) o solo sacarlo.
- Hasta 30 jugadores. Cada uno tiene un color y una figura propios, que ve en su celular y en la tele.
- Toda la información está en la tele. El celular es solo un control con botones.
- El que tiene el vaso toca 3 veces el botón gigante. Después aparecen hasta 4 botones de colores con figuras:
  en la tele se ve a qué compañero corresponde cada uno.
- Un reloj muestra cuánto falta para que explote el vaso, en la tele y en los celulares. Cuando quedan menos de 3 segundos se pone rojo y parpadea.
- Cada 5 a 10 segundos cae del cielo una sorpresa al azar y entra en el vaso. Afecta al que lo tiene en ese momento:
  - **Antiácido:** el reloj suma 5 segundos y alcanza con 1 toque. Cae como máximo 2 veces por vaso.
  - **Doble ácido:** el tiempo que queda se reduce casi a la mitad y hacen falta 6 toques.
- Los eliminados son fantasmas: tocan "¡Bu!" para hacer burbujear el vaso y apurarlo un poco.
- Puntos: cuanto más tarde explotás, más puntos sumás. El que sobrevive la ronda gana un bonus.
- Para ensayar sola, en la sala de espera está el botón **Agregar 3 bots de prueba**.

## Para la admin

- Para crear una partida en /host hace falta la **contraseña de admin**. No está escrita en el código,
  porque el repositorio es público. Se configura de una de estas dos formas:
  - con la variable de entorno `ADMIN_PASSWORD` (por ejemplo, en el panel de Hostinger), o
  - creando un archivo `admin-password.txt` al lado de `server.js`, con la contraseña adentro.
    Ese archivo está en `.gitignore`, así que nunca se sube a GitHub.
  Si no configurás ninguna, no pide contraseña y cualquiera puede crear partidas.
- **Pausa:** botón "Pausa" arriba (o la tecla P o la barra espaciadora). Frena el reloj y los celulares muestran "Pausa".
- **Pantalla completa:** botón arriba (si el navegador no deja, la tecla F11).
- **Música:** se puede apagar aparte del sonido. Se acelera a medida que se acerca la explosión.
- Durante el juego hay un QR chiquito con el PIN para los que llegan tarde (entran como fantasmas hasta la ronda siguiente).

## Puntos y premios

- Sacarte el vaso en menos de 1,5 segundos da **+50 puntos** ("¡Rápido!").
- Al final, además del podio, hay premios: Manos rápidas, Imán de ácido, Vengativo, Salvado por el antiácido y Fantasma molesto.

## Probarlo en tu computadora

1. Instalá Node.js 18 o más nuevo desde nodejs.org.
2. Abrí una terminal en esta carpeta y ejecutá:

       npm install
       npm start

3. En la computadora, abrí http://localhost:3000/host
4. Para jugar con celulares en la misma red wifi, en vez de "localhost" usá la IP de tu computadora
   (por ejemplo http://192.168.0.15:3000). La pantalla del juego muestra el QR con la dirección.

## Archivos

- `server.js`: servidor del juego (Node.js + Socket.IO).
- `public/host.html`: pantalla grande para proyectar.
- `public/laboratorio.html`: laboratorio virtual del ácido clorhídrico (se abre en **/laboratorio**). Funciona sin internet.
- `public/index.html`: control del celular de cada jugador.
- `public/style.css` y `public/fonts/`: estilo y tipografías.

El servidor usa el puerto de la variable `PORT` si existe; si no, el 3000.
