// Colores y figuras de cada jugador (los mismos en la tele y en el celular).
// Cada figura es un personajito con cara, para que sea su "foto de perfil".
window.IDENT = (function(){
  var COLORS = {
    rojo:    {bg:"#e5383b", fg:"#ffffff", dark:"#6e1014"},
    azul:    {bg:"#2f6fde", fg:"#ffffff", dark:"#0f2d66"},
    amarillo:{bg:"#f2b705", fg:"#3a2a00", dark:"#3a2a00"},
    verde:   {bg:"#1f9d55", fg:"#ffffff", dark:"#0b4a26"},
    violeta: {bg:"#8e4fd8", fg:"#ffffff", dark:"#3a1666"},
    naranja: {bg:"#f2711c", fg:"#ffffff", dark:"#6b2a00"}
  };
  function starPts(cx, cy, ro, ri){
    var pts = [];
    for (var i=0;i<10;i++){ var r = i%2 ? ri : ro, a = -Math.PI/2 + i*Math.PI/5; pts.push((cx + r*Math.cos(a)).toFixed(1) + "," + (cy + r*Math.sin(a)).toFixed(1)); }
    return pts.join(" ");
  }
  var SHAPES = {
    triangulo: {d:'<path d="M50 9 Q54 9 56 13 L93 81 Q95 88 88 88 L12 88 Q5 88 7 81 L44 13 Q46 9 50 9Z"/>', cx:50, cy:63, k:1.05},
    circulo:   {d:'<circle cx="50" cy="50" r="42"/>', cx:50, cy:52, k:1.3},
    cuadrado:  {d:'<rect x="10" y="10" width="80" height="80" rx="16"/>', cx:50, cy:52, k:1.3},
    rombo:     {d:'<path d="M50 5 Q53 5 56 8 L92 44 Q96 50 92 56 L56 92 Q50 97 44 92 L8 56 Q4 50 8 44 L44 8 Q47 5 50 5Z"/>', cx:50, cy:52, k:1.15},
    estrella:  {d:'<polygon stroke-linejoin="round" stroke-width="6" points="'+starPts(50,54,46,21)+'"/>', cx:50, cy:57, k:.85}
  };
  function face(s, col){
    var cx = s.cx, cy = s.cy, k = s.k, ex = 11*k, er = 5.2*k;
    return '<g fill="'+col+'">' +
      '<circle cx="'+(cx-ex)+'" cy="'+(cy-4*k)+'" r="'+er+'"/><circle cx="'+(cx+ex)+'" cy="'+(cy-4*k)+'" r="'+er+'"/>' +
      '<circle cx="'+(cx-ex+1.6*k)+'" cy="'+(cy-5.6*k)+'" r="'+(1.7*k)+'" fill="#fff" opacity=".9"/><circle cx="'+(cx+ex+1.6*k)+'" cy="'+(cy-5.6*k)+'" r="'+(1.7*k)+'" fill="#fff" opacity=".9"/>' +
      '</g><path d="M'+(cx-8*k)+' '+(cy+6*k)+' Q'+cx+' '+(cy+14*k)+' '+(cx+8*k)+' '+(cy+6*k)+'" fill="none" stroke="'+col+'" stroke-width="'+(3.6*k)+'" stroke-linecap="round"/>' +
      '<circle cx="'+(cx-ex-5*k)+'" cy="'+(cy+5*k)+'" r="'+(3.4*k)+'" fill="#ff7a9a" opacity=".55"/><circle cx="'+(cx+ex+5*k)+'" cy="'+(cy+5*k)+'" r="'+(3.4*k)+'" fill="#ff7a9a" opacity=".55"/>';
  }
  // svg(figura, colorDeRelleno, colorDeLaCara opcional)
  function svg(shape, fill, faceCol){
    var s = SHAPES[shape] || SHAPES.circulo;
    var body = s.d.replace("<polygon ", '<polygon stroke="'+fill+'" ');
    return '<svg viewBox="0 0 100 100" aria-hidden="true" style="display:block;width:100%;height:100%;overflow:visible">' +
      '<g fill="#000" transform="translate(0 4)" opacity=".18">'+body.replace('stroke="'+fill+'"','stroke="#000"').replace(/fill="[^"]*"/g,"")+'</g>' +
      '<g fill="'+fill+'">'+body+'</g>' + (faceCol ? face(s, faceCol) : "") + '</svg>';
  }
  function color(name){ return COLORS[name] || COLORS.violeta; }
  function faceColor(name){ var c = color(name); return c.fg === "#ffffff" ? c.dark : c.bg; }
  return { svg: svg, color: color, faceColor: faceColor };
})();
