// Aplica o tema escolhido antes da primeira pintura (sem piscar no tema errado).
// Sem escolha guardada, vale o tema do aparelho.
(function () {
  try {
    var t = localStorage.getItem('tema');
    if (t === 'claro' || t === 'escuro') document.documentElement.setAttribute('data-tema', t);
  } catch (e) { /* armazenamento bloqueado: segue o aparelho */ }
})();
