/* ============================================================
   CONFIGURAÇÃO
   ============================================================ */
const SUPABASE_URL = "https://wpgbzbvnxlofeuedxvpp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_RzCY36mfG06zijmMqmQdcA_YOl6q57n";
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STATUS_COLORS = {
  'ENTREGUE': '#4FD1C5', 'ATRASADO': '#FF5C5C', 'NO PRAZO': '#F2C94C',
  'ATENÇÃO': '#F2C94C', 'DIGITAR PEDIDO': '#8CA0B3', 'CANCELADO': '#4A5A6E', 'SEM STATUS': '#4A5A6E'
};
const ANOS_CONSIDERADOS = [2025, 2026]; // usado só no gráfico comparativo mensal
const STATUS_ABERTOS = ['ATRASADO','NO PRAZO','ATENÇÃO','CANCELADO']; // exclui ENTREGUE e DIGITAR PEDIDO

function anoDe(dataStr){
  if(!dataStr) return null;
  return parseInt(dataStr.slice(0,4),10);
}

/* ============================================================
   ESTADO GLOBAL
   ============================================================ */
let allProjetos = [];
let allNFs = [];
let filtro = { status: null, cliente: null }; // filtro cruzado entre gráficos
let charts = {}; // instâncias Chart.js por id de canvas
let currentPage = 1;
const PAGE_SIZE = 25;
let totalCount = 0;

/* ============================================================
   HELPERS
   ============================================================ */
async function fetchAllRows(table, columns){
  let allRows = [];
  let from = 0;
  const pageSize = 1000;
  while(true){
    const { data, error } = await db.from(table).select(columns).range(from, from + pageSize - 1);
    if(error) throw error;
    allRows = allRows.concat(data);
    if(data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

function formatCurrency(v){
  if(v === null || v === undefined) return '—';
  return v.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}
function formatCurrencyShort(v){
  if(v === null || v === undefined) return '—';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if(abs >= 1000000) return sign + 'R$' + (abs/1000000).toFixed(1) + 'M';
  if(abs >= 1000) return sign + 'R$' + (abs/1000).toFixed(0) + 'k';
  return sign + 'R$' + abs.toFixed(0);
}
function formatDate(d){
  if(!d) return '—';
  const [y,m,day] = d.split('-');
  return `${day}/${m}/${y}`;
}
function statusClass(status){
  if(!status) return '';
  return 'status-' + status.replace(/\s+/g,'').replace(/[ÇC]/g,'C').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function escapeHtml(str){
  if(str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function truncate(str, n){
  if(!str) return '—';
  return str.length > n ? str.slice(0,n) + '…' : str;
}
function destroyChart(id){
  if(charts[id]){ charts[id].destroy(); delete charts[id]; }
}

/* ============================================================
   MÁSCARA DE MOEDA
   ============================================================ */
function aplicarMascaraMoeda(input){
  input.addEventListener('input', function(){
    let v = this.value.replace(/\D/g,'');
    if(!v){ this.value = ''; return; }
    v = (parseInt(v,10)/100).toFixed(2);
    this.value = v.replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  });
}
function parseMoeda(str){
  if(!str) return null;
  const v = parseFloat(String(str).replace(/\./g,'').replace(',','.'));
  return isNaN(v) ? null : v;
}
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app');

// Máscara de moeda no campo valor do modal
aplicarMascaraMoeda(document.getElementById('f-valor'));

async function checkSession(){
  const { data } = await db.auth.getSession();
  if(data.session){ showApp(data.session.user); } else { showLogin(); }
}
function showLogin(){ loginScreen.style.display = 'flex'; appScreen.style.display = 'none'; }
function showApp(user){
  loginScreen.style.display = 'none';
  appScreen.style.display = 'flex';
  document.getElementById('user-email').textContent = user.email;
  loadDashboard();
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Entrando...';
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Entrar';
  if(error){
    errEl.textContent = 'E-mail ou senha inválidos. Verifique e tente novamente.';
    errEl.style.display = 'block';
    return;
  }
  showApp(data.user);
});
document.getElementById('logout-btn').addEventListener('click', async () => {
  await db.auth.signOut(); showLogin();
});

/* ============================================================
   TABS
   ============================================================ */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    if(btn.dataset.tab === 'tab-basedados'){ loadBaseDados(); }
    if(btn.dataset.tab === 'tab-notas'){ loadNotasFiscais(); }
  });
});

/* ============================================================
   CARREGAMENTO PRINCIPAL
   ============================================================ */
async function loadDashboard(){
  try{
    allProjetos = await fetchAllRows('projetos', 'id, status, valor, data_pedido, data_entrega, cliente, num_produto, descricao_empresa, qtd_pedido');
    allNFs = await fetchAllRows('notas_fiscais', 'id, valor, data_emissao, cliente, nf_numero, tipo_nota, descricao, qtd_entregue, empresa, num_pedido');
  } catch(err){
    document.getElementById('kpi-grid').innerHTML = `<div class="empty-state">Erro ao carregar dados: ${err.message}</div>`;
    return;
  }
  renderAll();
  await loadStatusFilterOptions();
  await loadProjetosTable();
}

function renderAll(){
  const projetosFiltrados = applyFiltroProjetos(allProjetos);
  const nfsFiltradas = applyFiltroNFs(allNFs);

  renderKPIs(projetosFiltrados, nfsFiltradas);
  renderStatusBarChart(allProjetos);
  renderMensalComparativoChart(allNFs); // este é o único com 2025+2026
  renderRankingClientes(nfsFiltradas);
  renderRankingTicketPorUnidade(projetosFiltrados);
  renderTopProdutosChart(projetosFiltrados);
  renderFilterPill();
}

function applyFiltroProjetos(projetos){
  let out = projetos;
  if(filtro.status) out = out.filter(p => (p.status||'').toUpperCase() === filtro.status);
  if(filtro.cliente) out = out.filter(p => p.cliente === filtro.cliente);
  return out;
}
function applyFiltroNFs(nfs){
  let out = nfs;
  if(filtro.cliente) out = out.filter(n => n.cliente === filtro.cliente);
  return out;
}

function renderFilterPill(){
  const pill = document.getElementById('filter-pill');
  const parts = [];
  if(filtro.status) parts.push(`Status: ${filtro.status}`);
  if(filtro.cliente) parts.push(`Cliente: ${filtro.cliente}`);
  if(parts.length){
    pill.classList.add('active');
    document.getElementById('filter-pill-text').textContent = 'Filtro ativo — ' + parts.join(' · ');
  } else {
    pill.classList.remove('active');
  }
}
document.getElementById('filter-pill-clear').addEventListener('click', () => {
  filtro = { status: null, cliente: null };
  renderAll();
  loadProjetosTable();
});

/* ============================================================
   KPIs
   ============================================================ */
function renderKPIs(projetosFiltradosCruzado, nfsFiltradasCruzado){
  const ANO_REF = 2026;

  // Projetos e NFs só do ano de referência (2026), usando data_pedido / data_emissao
  const projetos2026 = allProjetos.filter(p => anoDe(p.data_pedido) === ANO_REF);
  const nfs2026 = allNFs.filter(n => anoDe(n.data_emissao) === ANO_REF);

  // Aplica o filtro cruzado (status/cliente) só sobre o recorte de 2026
  const projetos2026Filtrados = applyFiltroProjetos(projetos2026);

  // ---- Mês de referência: mês atual, ou o último mês de 2026 com faturamento, se o atual for zero ----
  const now = new Date();
  const mesAtualReal = now.getMonth() + 1; // 1-12

  const faturamentoPorMes2026 = {};
  nfs2026.forEach(n => {
    const mes = parseInt(n.data_emissao.slice(5,7),10);
    faturamentoPorMes2026[mes] = (faturamentoPorMes2026[mes]||0) + (n.valor||0);
  });

  let mesReferencia = mesAtualReal;
  if(!faturamentoPorMes2026[mesAtualReal]){
    // procura, voltando no tempo, o último mês de 2026 com faturamento > 0
    for(let m = mesAtualReal; m >= 1; m--){
      if(faturamentoPorMes2026[m] > 0){ mesReferencia = m; break; }
    }
  }
  const faturadoMesReferencia = faturamentoPorMes2026[mesReferencia] || 0;
  const nomesMeses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const nomeMesRef = nomesMeses[mesReferencia-1];
  const labelMesCard = mesReferencia === mesAtualReal ? `Faturado em ${nomeMesRef}` : `Faturado em ${nomeMesRef} (último mês c/ dados)`;

  // ---- Valor em aberto, total projetos, atrasados — tudo só 2026 ----
  const valorEmAberto = projetos2026
    .filter(p => !['ENTREGUE','CANCELADO'].includes((p.status||'').toUpperCase()))
    .reduce((s,p) => s + (p.valor||0), 0);
  const totalProjetos = projetos2026Filtrados.length;
  const atrasados = projetos2026.filter(p => (p.status||'').toUpperCase()==='ATRASADO').length;

  // ---- Comparação por período: Jan até mesReferencia, 2026 vs 2025 (mesmo período) ----
  const somaPeriodo = (nfs, ano, ateMs) => nfs
    .filter(n => anoDe(n.data_emissao) === ano && parseInt(n.data_emissao.slice(5,7),10) <= ateMs)
    .reduce((s,n) => s + (n.valor||0), 0);

  const valorPeriodo2026 = somaPeriodo(allNFs, 2026, mesReferencia);
  const valorPeriodo2025 = somaPeriodo(allNFs, 2025, mesReferencia);
  const pctVariacao = valorPeriodo2025 > 0 ? ((valorPeriodo2026 - valorPeriodo2025)/valorPeriodo2025*100) : null;
  const nomeMesAbrev = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][mesReferencia-1];
  const periodoLabel = `Jan–${nomeMesAbrev}`;

  const valorTotalAno2026 = nfs2026.reduce((s,n)=>s+(n.valor||0),0);
  const diferencaReais = valorPeriodo2026 - valorPeriodo2025;
  const pctVariacaoFinal = valorPeriodo2025 > 0 ? ((valorPeriodo2026 - valorPeriodo2025)/valorPeriodo2025*100) : null;
  const variacaoTexto = pctVariacaoFinal === null
    ? `sem dado de 2025 no período (${periodoLabel})`
    : `${pctVariacaoFinal>=0?'▲ +':'▼ '}${pctVariacaoFinal.toFixed(1)}% · ${diferencaReais>=0?'+':''}${formatCurrency(diferencaReais)} vs ${periodoLabel}/2025`;
  const variacaoCor = pctVariacaoFinal === null ? 'var(--text-muted)' : (pctVariacaoFinal>=0 ? 'var(--ok)' : 'var(--danger)');

  // ---- Faturamento médio mensal 2026 (apenas NFs) ----
  const mesesComFaturamento2026 = Object.values(faturamentoPorMes2026).filter(v => v > 0).length;
  const faturamentoMedioMensal2026 = mesesComFaturamento2026 > 0 ? valorTotalAno2026 / mesesComFaturamento2026 : 0;

  // ---- Clientes ativos 2026 (com ao menos 1 NF emitida) ----
  const clientesAtivos2026 = new Set(nfs2026.map(n => n.cliente).filter(Boolean)).size;

  document.getElementById('kpi-grid').innerHTML = `
    ${kpiCardSub(`Faturamento Acumulado 2026 (${periodoLabel})`, formatCurrency(valorPeriodo2026), variacaoTexto, variacaoCor)}
    ${kpiCard(labelMesCard, formatCurrency(faturadoMesReferencia), null, 'var(--accent)')}
    ${kpiCard('Faturamento Médio Mensal 2026', formatCurrency(faturamentoMedioMensal2026), `Baseado em ${mesesComFaturamento2026} mês${mesesComFaturamento2026!==1?'es':''} com NFs`, 'var(--ok)')}
    ${kpiCard('Clientes Ativos 2026', clientesAtivos2026.toLocaleString('pt-BR'), 'Com ao menos 1 NF emitida', 'var(--ok)')}
    ${kpiCard('Projetos Atrasados 2026', atrasados.toLocaleString('pt-BR'), null, 'var(--danger)')}
    ${kpiCard('Valor em Aberto 2026 (a faturar)', formatCurrency(valorEmAberto), null, 'var(--warn)')}
  `;
}
function kpiCard(label, value, sub, color){
  return `<div class="kpi-card">
    <div class="label">${label}</div><div class="value">${value}</div>
    ${sub ? `<div class="sub" style="color:${color}">${sub}</div>` : ''}
    <div class="bar"><span style="width:100%; background:${color};"></span></div>
  </div>`;
}
function kpiCardSub(label, value, subLabel, subColor){
  return `<div class="kpi-card">
    <div class="label">${label}</div><div class="value">${value}</div>
    <div class="sub" style="color:${subColor}">${subLabel}</div>
    <div class="bar"><span style="width:100%; background:${subColor};"></span></div>
  </div>`;
}

/* ============================================================
   GRÁFICO: STATUS 2026 (atrasado, no prazo, atenção, cancelado)
   Eixo Y = status, eixo X = valor em R$. Rótulos de qtd+valor sempre visíveis.
   ============================================================ */
function renderStatusBarChart(){
  const projetos2026 = allProjetos.filter(p => anoDe(p.data_pedido) === 2026 && (!filtro.cliente || p.cliente === filtro.cliente));
  const byStatus = {};
  STATUS_ABERTOS.forEach(s => byStatus[s] = { qtd:0, valor:0 });

  projetos2026.forEach(p => {
    const s = (p.status || '').toUpperCase();
    if(!STATUS_ABERTOS.includes(s)) return;
    byStatus[s].qtd += 1;
    byStatus[s].valor += (p.valor||0);
  });

  const labels = STATUS_ABERTOS;
  const valores = labels.map(l => byStatus[l].valor);
  const qtds = labels.map(l => byStatus[l].qtd);
  const colors = labels.map(l => STATUS_COLORS[l] || '#FF6B35');

  destroyChart('chart-status-bar');
  const ctx = document.getElementById('chart-status-bar').getContext('2d');
  charts['chart-status-bar'] = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{ data:valores, backgroundColor: colors, borderRadius:5,
      borderColor: labels.map(l => filtro.status===l ? '#fff' : 'transparent'), borderWidth:2 }] },
    options:{
      indexAxis:'y',
      responsive:true, maintainAspectRatio:false,
      onClick:(evt, elements) => {
        if(elements.length){
          const idx = elements[0].index;
          const status = labels[idx];
          filtro.status = (filtro.status === status) ? null : status;
          renderAll();
          loadProjetosTable();
        }
      },
      plugins:{
        legend:{ display:false },
        tooltip:{ callbacks:{ label: (c) => [`Valor: ${formatCurrency(c.raw)}`, `Qtd: ${qtds[c.dataIndex]} projetos`] } }
      },
      scales:{
        x:{ ticks:{ color:'#8CA0B3', font:{ size:10 }, callback:(v)=>formatCurrencyShort(v) }, grid:{ color:'#24384F' } },
        y:{ ticks:{ color:'#E8EDF2', font:{ size:12, weight:'600' } }, grid:{ display:false } }
      },
      layout:{ padding:{ right:110 } }
    },
    plugins:[{
      id:'dataLabelsCustom',
      afterDatasetsDraw(chart){
        const {ctx} = chart;
        chart.getDatasetMeta(0).data.forEach((bar, i) => {
          ctx.save();
          ctx.font = "600 12px 'IBM Plex Mono', monospace";
          ctx.fillStyle = '#E8EDF2';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${qtds[i]} proj · ${formatCurrency(valores[i])}`, bar.x + 10, bar.y);
          ctx.restore();
        });
      }
    }]
  });
}

/* ============================================================
   GRÁFICO: COMPARATIVO MENSAL 2025 vs 2026
   ============================================================ */
function renderMensalComparativoChart(nfs){
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const dados = { 2025: new Array(12).fill(0), 2026: new Array(12).fill(0) };

  nfs.forEach(n => {
    if(!n.data_emissao) return;
    const ano = parseInt(n.data_emissao.slice(0,4),10);
    const mes = parseInt(n.data_emissao.slice(5,7),10) - 1;
    if(dados[ano]) dados[ano][mes] += (n.valor||0);
  });

  const pctVariacao = meses.map((_,i) => {
    const v25 = dados[2025][i], v26 = dados[2026][i];
    if(v25 === 0) return null;
    return ((v26 - v25)/v25*100);
  });

  destroyChart('chart-mensal-comparativo');
  const ctx = document.getElementById('chart-mensal-comparativo').getContext('2d');
  charts['chart-mensal-comparativo'] = new Chart(ctx, {
    type:'bar',
    data:{
      labels: meses,
      datasets:[
        { label:'2025', data: dados[2025], backgroundColor:'#8CA0B3', borderRadius:4 },
        { label:'2026', data: dados[2026], backgroundColor:'#FF6B35', borderRadius:4 }
      ]
    },
    options:{
      indexAxis:'y',
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{ position:'top', labels:{ color:'#8CA0B3', font:{ size:11 } } },
        tooltip:{ callbacks:{ label:(c) => `${c.dataset.label}: ${formatCurrency(c.raw)}` } }
      },
      scales:{
        x:{ ticks:{ color:'#8CA0B3', font:{ size:10 }, callback:(v)=>formatCurrencyShort(v) }, grid:{ color:'#24384F' } },
        y:{ ticks:{ color:'#E8EDF2', font:{ size:11 } }, grid:{ display:false } }
      },
      layout:{ padding:{ right:90 } }
    },
    plugins:[{
      id:'labelsComparativo',
      afterDatasetsDraw(chart){
        const {ctx} = chart;
        ctx.save();
        ctx.font = "600 10px 'IBM Plex Mono', monospace";
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        chart.data.datasets.forEach((ds, dsIdx) => {
          chart.getDatasetMeta(dsIdx).data.forEach((bar, i) => {
            if(ds.data[i] > 0){
              ctx.fillStyle = dsIdx === 0 ? '#8CA0B3' : '#FF6B35';
              ctx.fillText(formatCurrencyShort(ds.data[i]), bar.x + 8, bar.y);
            }
          });
        });
        // % variação — posicionada à direita da barra mais longa de cada par
        meses.forEach((_, i) => {
          const pct = pctVariacao[i];
          if(pct === null) return;
          const bar25 = chart.getDatasetMeta(0).data[i];
          const bar26 = chart.getDatasetMeta(1).data[i];
          const maxX = Math.max(bar25.x, bar26.x);
          const midY = (bar25.y + bar26.y) / 2;
          ctx.fillStyle = pct >= 0 ? '#4FD1C5' : '#FF5C5C';
          ctx.font = "700 10px 'IBM Plex Mono', monospace";
          ctx.fillText(`${pct>=0?'▲':'▼'} ${Math.abs(pct).toFixed(0)}%`, maxX + 55, midY);
        });
        ctx.restore();
      }
    }]
  });
}

/* ============================================================
   RANKINGS (lista com scroll, clicável para filtrar cruzado)
   ============================================================ */
function renderRankingClientes(nfsFiltradasCruzado){
  // Ranking baseado somente em NFs de 2026
  const nfs2026 = allNFs.filter(n => anoDe(n.data_emissao) === 2026 && (!filtro.cliente || n.cliente === filtro.cliente));
  const porCliente = {};
  nfs2026.forEach(n => {
    const c = n.cliente || 'Sem cliente';
    porCliente[c] = (porCliente[c]||0) + (n.valor||0);
  });

  const totalGeral = Object.values(porCliente).reduce((s,v)=>s+v,0);
  let rows = Object.entries(porCliente).map(([cliente,total]) => ({ cliente, total, pct: totalGeral>0? total/totalGeral*100 : 0 }));
  rows.sort((a,b) => b.total-a.total);
  const maxVal = Math.max(...rows.map(r=>r.total), 1);

  document.getElementById('rank-clientes').innerHTML = rows.map(r => `
    <div class="rank-row ${filtro.cliente===r.cliente?'selected':''}" onclick="toggleClienteFiltro('${escapeHtml(r.cliente).replace(/'/g,"\\'")}')">
      <div class="rank-label" title="${escapeHtml(r.cliente)}">${escapeHtml(r.cliente)}</div>
      <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${(r.total/maxVal*100)}%; background:#FF6B35;"></div></div>
      <div class="rank-value"><b>${formatCurrency(r.total)}</b> · ${r.pct.toFixed(1)}%</div>
    </div>
  `).join('') || '<div class="empty-state">Sem dados em 2026.</div>';
}

function renderRankingTicketPorUnidade(projetosFiltradosCruzado){
  const projetos2026 = allProjetos.filter(p => anoDe(p.data_pedido) === 2026 && (!filtro.cliente || p.cliente === filtro.cliente));
  const porCliente = {};
  projetos2026.forEach(p => {
    const qtd = p.qtd_pedido;
    if(!qtd || qtd <= 0 || p.valor == null) return; // só entra no cálculo quando dá pra saber a quantidade
    const c = p.cliente || 'Sem cliente';
    if(!porCliente[c]) porCliente[c] = { valorTotal:0, qtdTotal:0 };
    porCliente[c].valorTotal += p.valor;
    porCliente[c].qtdTotal += qtd;
  });
  let rows = Object.entries(porCliente)
    .filter(([,v]) => v.qtdTotal > 0)
    .map(([cliente,v]) => ({ cliente, ticket: v.valorTotal/v.qtdTotal, qtd: v.qtdTotal }));
  rows.sort((a,b) => b.ticket-a.ticket);
  const maxVal = Math.max(...rows.map(r=>r.ticket), 1);

  document.getElementById('rank-ticket').innerHTML = rows.map(r => `
    <div class="rank-row ${filtro.cliente===r.cliente?'selected':''}" onclick="toggleClienteFiltro('${escapeHtml(r.cliente).replace(/'/g,"\\'")}')">
      <div class="rank-label" title="${escapeHtml(r.cliente)}">${escapeHtml(r.cliente)}</div>
      <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${(r.ticket/maxVal*100)}%; background:#4FD1C5;"></div></div>
      <div class="rank-value"><b>${formatCurrency(r.ticket)}</b> · ${r.qtd.toLocaleString('pt-BR')} unidades</div>
    </div>
  `).join('') || '<div class="empty-state">Sem dados de quantidade suficientes em 2026.</div>';
}

function toggleClienteFiltro(cliente){
  filtro.cliente = (filtro.cliente === cliente) ? null : cliente;
  renderAll();
  loadProjetosTable();
}

/* ============================================================
   TOP PRODUTOS
   ============================================================ */
function renderTopProdutosChart(projetosFiltradosCruzado){
  const projetos2026 = allProjetos.filter(p => anoDe(p.data_pedido) === 2026 && (!filtro.cliente || p.cliente === filtro.cliente) && (!filtro.status || (p.status||'').toUpperCase() === filtro.status));
  const porProduto = {};
  projetos2026.forEach(p => {
    const prod = p.num_produto || p.descricao_empresa;
    if(!prod) return;
    const key = String(prod).slice(0,40);
    porProduto[key] = (porProduto[key]||0) + (p.valor||0);
  });
  const top = Object.entries(porProduto).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const labels = top.map(t=>t[0]);
  const values = top.map(t=>t[1]);

  destroyChart('chart-top-produtos');
  const ctx = document.getElementById('chart-top-produtos').getContext('2d');
  charts['chart-top-produtos'] = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{ data: values, backgroundColor:'#F2C94C', borderRadius:4 }] },
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(c)=>formatCurrency(c.raw) } } },
      scales:{
        x:{ ticks:{ color:'#8CA0B3', font:{ size:10 }, callback:(v)=>formatCurrencyShort(v) }, grid:{ color:'#24384F' } },
        y:{ ticks:{ color:'#8CA0B3', font:{ size:10 } }, grid:{ display:false } }
      }
    }
  });
}

/* ============================================================
   FILTRO DE STATUS (dropdown da tabela) + BUSCA
   ============================================================ */
async function loadStatusFilterOptions(){
  const statuses = [...new Set(allProjetos.map(p => (p.status||'').toUpperCase()).filter(Boolean))];
  const sel = document.getElementById('filter-status');
  sel.innerHTML = '<option value="">Todos os status</option>' + statuses.map(s => `<option value="${s}">${s}</option>`).join('');
}

let searchTimeout = null;
document.getElementById('search-input').addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => { currentPage = 1; loadProjetosTable(); }, 350);
});
document.getElementById('filter-status').addEventListener('change', (e) => {
  filtro.status = e.target.value || null;
  currentPage = 1;
  renderAll();
  loadProjetosTable();
});

/* ============================================================
   TABELA DE PROJETOS (paginada, respeita filtro cruzado)
   ============================================================ */
async function loadProjetosTable(){
  const tbody = document.getElementById('projetos-tbody');
  tbody.innerHTML = `<tr><td colspan="8" class="loading-inline">Carregando...</td></tr>`;

  const search = document.getElementById('search-input').value.trim();
  document.getElementById('filter-status').value = filtro.status || '';

  let query = db.from('projetos').select('*', { count:'exact' });
  if(search) query = query.or(`cliente.ilike.%${search}%,num_pedido.ilike.%${search}%`);
  if(filtro.status) query = query.eq('status', filtro.status);
  if(filtro.cliente) query = query.eq('cliente', filtro.cliente);

  const from = (currentPage-1)*PAGE_SIZE, to = from+PAGE_SIZE-1;
  query = query.order('data_pedido',{ascending:false, nullsFirst:false}).range(from,to);

  const { data, error, count } = await query;
  if(error){ tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Erro: ${error.message}</td></tr>`; return; }
  totalCount = count||0;

  if(!data || data.length===0){
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Nenhum projeto encontrado com esses filtros.</td></tr>`;
    renderPagination(); return;
  }

  tbody.innerHTML = data.map(p => `
    <tr>
      <td>${escapeHtml(p.cliente||'—')}</td>
      <td class="num-cell">${escapeHtml(p.num_pedido||'—')}</td>
      <td class="num-cell">${formatDate(p.data_pedido)}</td>
      <td>${escapeHtml(truncate(p.descricao_empresa,60))}</td>
      <td class="num-cell">${formatDate(p.data_entrega)}</td>
      <td><span class="status-badge ${statusClass(p.status)}">${escapeHtml(p.status||'—')}</span></td>
      <td class="num-cell">${formatCurrency(p.valor)}</td>
      <td><button class="edit-btn" onclick="openEditModal(${p.id})">Editar</button></td>
    </tr>
  `).join('');
  renderPagination();
}
function renderPagination(){
  const totalPages = Math.max(1, Math.ceil(totalCount/PAGE_SIZE));
  const el = document.getElementById('pagination');
  el.innerHTML = `
    <button ${currentPage===1?'disabled':''} onclick="goToPage(${currentPage-1})">‹ Anterior</button>
    <button class="active" disabled>${currentPage} / ${totalPages}</button>
    <button ${currentPage>=totalPages?'disabled':''} onclick="goToPage(${currentPage+1})">Próxima ›</button>
  `;
}
function goToPage(p){ currentPage=p; loadProjetosTable(); }

/* ============================================================
   ABA "BASE DE DADOS" — grade única com scroll, ordenação por
   coluna e edição protegida por ícone de lápis
   ============================================================ */
let bdAllRows = [];
let bdSort = { field: 'id', dir: 'desc' };
let bdFilters = { data_pedido: null, data_entrega: null, status: null, cliente: null };
let coresAtivas = false;

document.getElementById('bd-btn-cores').addEventListener('click', (e) => {
  coresAtivas = !coresAtivas;
  e.target.classList.toggle('active', coresAtivas);
  e.target.textContent = coresAtivas ? 'Desativar Cores' : 'Ativar Cores';
  renderBaseDados();
});

document.getElementById('bd-btn-add-projeto').addEventListener('click', () => openNewModal());

let bdSearchTimeout = null;
document.getElementById('bd-search-input').addEventListener('input', () => {
  clearTimeout(bdSearchTimeout);
  bdSearchTimeout = setTimeout(() => renderBaseDados(), 250);
});

document.querySelectorAll('.sortable-th').forEach(th => {
  th.addEventListener('click', (e) => {
    if(e.target.classList.contains('filter-icon')) return; // não ordena ao clicar no filtro
    const field = th.dataset.field;
    if(bdSort.field === field){
      bdSort.dir = bdSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      bdSort = { field, dir: 'asc' };
    }
    document.querySelectorAll('.sortable-th .sort-arrow').forEach(a => a.textContent = '');
    th.querySelector('.sort-arrow').textContent = bdSort.dir === 'asc' ? '\u25b2' : '\u25bc';
    renderBaseDados();
  });
});

// Abre/fecha o dropdown de filtro ao clicar no ícone de funil
document.querySelectorAll('.filter-icon').forEach(icon => {
  icon.addEventListener('click', (e) => {
    e.stopPropagation();
    const field = icon.dataset.filter;
    const dropdown = document.getElementById('filter-dropdown-' + field);
    const isOpen = dropdown.classList.contains('open');
    document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('open'));
    if(!isOpen) dropdown.classList.add('open');
  });
});
document.addEventListener('click', () => {
  document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('open'));
});

function aplicarFiltroData(field){
  const modo = document.querySelector(`input[name="modo-${field}"]:checked`).value;
  const valor = document.getElementById('dp-valor-' + field).value;
  if(!valor){ bdFilters[field] = null; }
  else { bdFilters[field] = { modo, valor }; }
  atualizarResumosFiltro();
  document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('open'));
  renderBaseDados();
}
function limparFiltroData(field){
  bdFilters[field] = null;
  document.getElementById('dp-valor-' + field).value = '';
  atualizarResumosFiltro();
  document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('open'));
  renderBaseDados();
}

function popularCheckboxesStatus(){
  const statusOptions = ['DIGITAR PEDIDO','NO PRAZO','ATENÇÃO','ATRASADO','ENTREGUE','CANCELADO'];
  const container = document.getElementById('status-checkboxes');
  container.innerHTML = statusOptions.map(s => `
    <div class="filter-checkbox-row">
      <input type="checkbox" value="${s}" id="chk-status-${s.replace(/\s+/g,'')}" checked>
      <label for="chk-status-${s.replace(/\s+/g,'')}" style="margin:0; text-transform:none;">${s}</label>
    </div>
  `).join('');
}
function aplicarFiltroStatus(){
  const checked = Array.from(document.querySelectorAll('#status-checkboxes input:checked')).map(c => c.value);
  const statusOptions = ['DIGITAR PEDIDO','NO PRAZO','ATENÇÃO','ATRASADO','ENTREGUE','CANCELADO'];
  bdFilters.status = (checked.length === statusOptions.length || checked.length === 0) ? null : checked;
  atualizarResumosFiltro();
  document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('open'));
  renderBaseDados();
}
function limparFiltroStatus(){
  document.querySelectorAll('#status-checkboxes input').forEach(c => c.checked = true);
  bdFilters.status = null;
  atualizarResumosFiltro();
  document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('open'));
  renderBaseDados();
}

/* ---- Filtro de Cliente (lista com checkbox, ordenada A-Z, com busca) ---- */
function popularCheckboxesCliente(){
  const clientesUnicos = [...new Set(bdAllRows.map(p => p.cliente).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  const container = document.getElementById('cliente-checkboxes');
  container.innerHTML = clientesUnicos.map((c,i) => `
    <div class="filter-checkbox-row" data-cliente-nome="${escapeHtml(c).toLowerCase()}">
      <input type="checkbox" value="${escapeHtml(c)}" id="chk-cliente-${i}" checked>
      <label for="chk-cliente-${i}" style="margin:0; text-transform:none;">${escapeHtml(c)}</label>
    </div>
  `).join('');
}
function filtrarListaClientes(){
  const busca = document.getElementById('cliente-filtro-busca').value.trim().toLowerCase();
  document.querySelectorAll('#cliente-checkboxes .filter-checkbox-row').forEach(row => {
    row.style.display = row.dataset.clienteNome.includes(busca) ? 'flex' : 'none';
  });
}
function aplicarFiltroCliente(){
  const todos = Array.from(document.querySelectorAll('#cliente-checkboxes input'));
  const checked = todos.filter(c => c.checked).map(c => c.value);
  bdFilters.cliente = (checked.length === todos.length || checked.length === 0) ? null : checked;
  atualizarResumosFiltro();
  document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('open'));
  renderBaseDados();
}
function limparFiltroCliente(){
  document.querySelectorAll('#cliente-checkboxes input').forEach(c => c.checked = true);
  document.getElementById('cliente-filtro-busca').value = '';
  filtrarListaClientes();
  bdFilters.cliente = null;
  atualizarResumosFiltro();
  document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('open'));
  renderBaseDados();
}

function formatDateBR(iso){
  if(!iso) return '';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function atualizarResumosFiltro(){
  document.querySelectorAll('.filter-icon').forEach(icon => {
    const field = icon.dataset.filter;
    icon.classList.toggle('active', !!bdFilters[field]);
  });

  const setResumo = (field, texto) => {
    const el = document.getElementById('filter-summary-' + field);
    if(el) el.textContent = texto || '';
  };

  setResumo('cliente', bdFilters.cliente ? `${bdFilters.cliente.length} cliente${bdFilters.cliente.length>1?'s':''} filtrado${bdFilters.cliente.length>1?'s':''}` : '');
  setResumo('status', bdFilters.status ? `${bdFilters.status.length} ite${bdFilters.status.length>1?'ns':'m'} filtrado${bdFilters.status.length>1?'s':''}` : '');

  ['data_pedido','data_entrega'].forEach(field => {
    const f = bdFilters[field];
    if(!f){ setResumo(field, ''); return; }
    setResumo(field, `${f.modo==='eq' ? 'Igual a' : 'A partir de'} ${formatDateBR(f.valor)}`);
  });
}

async function loadBaseDados(){
  const tbody = document.getElementById('bd-tbody');
  tbody.innerHTML = `<tr><td colspan="9" class="loading-inline">Carregando todos os projetos...</td></tr>`;
  try{
    bdAllRows = await fetchAllRows('projetos', '*');
  } catch(err){
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Erro ao carregar: ${err.message}</td></tr>`;
    return;
  }
  popularCheckboxesStatus();
  popularCheckboxesCliente();
  renderBaseDados();
}

function renderBaseDados(){
  const tbody = document.getElementById('bd-tbody');
  const search = document.getElementById('bd-search-input').value.trim().toLowerCase();

  let rows = bdAllRows;
  if(search){
    rows = rows.filter(p =>
      (p.cliente||'').toLowerCase().includes(search) ||
      (p.num_pedido||'').toLowerCase().includes(search)
    );
  }

  // Filtro de datas (a partir de / igual a)
  ['data_pedido','data_entrega'].forEach(field => {
    const f = bdFilters[field];
    if(!f) return;
    rows = rows.filter(p => {
      if(!p[field]) return false;
      return f.modo === 'eq' ? p[field] === f.valor : p[field] >= f.valor;
    });
  });

  // Filtro de status (lista de selecionados)
  if(bdFilters.status){
    rows = rows.filter(p => bdFilters.status.includes((p.status||'').toUpperCase()));
  }

  // Filtro de cliente (lista de selecionados)
  if(bdFilters.cliente){
    rows = rows.filter(p => bdFilters.cliente.includes(p.cliente));
  }

  rows = [...rows].sort((a,b) => {
    let va = a[bdSort.field], vb = b[bdSort.field];
    if(bdSort.field === 'valor'){ va = va||0; vb = vb||0; }
    else { va = (va===null||va===undefined) ? '' : va; vb = (vb===null||vb===undefined) ? '' : vb; }
    if(va < vb) return bdSort.dir === 'asc' ? -1 : 1;
    if(va > vb) return bdSort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  if(rows.length === 0){
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Nenhum projeto encontrado com esses filtros.</td></tr>`;
    return;
  }

  const statusOptions = ['DIGITAR PEDIDO','NO PRAZO','ATENÇÃO','ATRASADO','ENTREGUE','CANCELADO'];
  const corClasse = (status) => {
    if(!coresAtivas) return '';
    const s = (status||'').toUpperCase();
    if(s === 'ENTREGUE') return 'cor-entregue';
    if(s === 'ATRASADO') return 'cor-atrasado';
    if(s === 'ATENÇÃO') return 'cor-atencao';
    if(s === 'NO PRAZO') return 'cor-noprazo';
    if(s === 'DIGITAR PEDIDO') return 'cor-digitarpedido';
    return '';
  };

  tbody.innerHTML = rows.map(p => `
    <tr data-id="${p.id}" class="${corClasse(p.status)}">
      <td>
        <button class="edit-pencil" onclick="toggleRowEdit(${p.id}, this)" title="Editar linha">✎</button>
        <button class="edit-pencil" onclick="deleteRow(${p.id})" title="Apagar lançamento" style="margin-left:4px; color:var(--danger); border-color:var(--danger);">🗑</button>
        <span class="save-indicator">✓ salvo</span>
      </td>
      <td><input class="inline-input" disabled data-field="cliente" value="${escapeHtml(p.cliente||'')}"></td>
      <td><input class="inline-input" disabled data-field="num_pedido" value="${escapeHtml(p.num_pedido||'')}"></td>
      <td><input class="inline-input" disabled type="date" data-field="data_pedido" value="${p.data_pedido||''}"></td>
      <td><input class="inline-input" disabled data-field="solicitante" value="${escapeHtml(p.solicitante||'')}"></td>
      <td><input class="inline-input" disabled type="date" data-field="data_entrega" value="${p.data_entrega||''}"></td>
      <td>
        <select class="inline-select" disabled data-field="status">
          ${statusOptions.map(s => `<option value="${s}" ${p.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </td>
      <td style="display:flex; align-items:center; gap:4px;"><span style="color:var(--text-muted); font-size:11px;">R$</span><input class="inline-input" disabled type="number" step="0.01" data-field="valor" value="${p.valor ?? ''}"></td>
      <td><input class="inline-input" disabled data-field="nf_numero_original" value="${escapeHtml(p.nf_numero_original||'')}"></td>
    </tr>
  `).join('');
}

function toggleRowEdit(id, btn){
  const tr = btn.closest('tr');
  const inputs = tr.querySelectorAll('[data-field]');
  const isEditing = btn.classList.contains('editing');

  if(!isEditing){
    inputs.forEach(i => i.disabled = false);
    btn.classList.add('editing');
    btn.textContent = '\ud83d\udcbe';
    btn.title = 'Salvar alterações';
  } else {
    saveRow(id, tr, btn);
  }
}

async function saveRow(id, tr, btn){
  const inputs = tr.querySelectorAll('[data-field]');
  const payload = {};
  inputs.forEach(input => {
    let value = input.value.trim ? input.value.trim() : input.value;
    if(input.dataset.field === 'valor') value = value === '' ? null : parseFloat(value);
    if(value === '') value = null;
    payload[input.dataset.field] = value;
  });

  btn.disabled = true;
  const { error } = await db.from('projetos').update(payload).eq('id', id);
  btn.disabled = false;

  if(error){
    alert('Erro ao salvar: ' + error.message);
    return;
  }

  inputs.forEach(i => i.disabled = true);
  btn.classList.remove('editing');
  btn.textContent = '\u270e';
  btn.title = 'Editar linha';

  const indicator = tr.querySelector('.save-indicator');
  indicator.classList.add('show');
  setTimeout(() => indicator.classList.remove('show'), 1500);

  const idx = bdAllRows.findIndex(r => r.id === id);
  if(idx > -1) bdAllRows[idx] = { ...bdAllRows[idx], ...payload };
}

async function deleteRow(id){
  if(!confirm('Tem certeza que deseja apagar este lançamento? Esta ação não pode ser desfeita.')) return;

  const { error } = await db.from('projetos').delete().eq('id', id);
  if(error){
    alert('Erro ao apagar: ' + error.message);
    return;
  }

  // Verifica se realmente foi deletado
  const { data: check } = await db.from('projetos').select('id').eq('id', id).single();
  if(check){
    alert('Não foi possível apagar este registro. Verifique as permissões no Supabase (RLS).');
    return;
  }

  // Remove das listas locais
  bdAllRows = bdAllRows.filter(r => r.id !== id);
  allProjetos = allProjetos.filter(r => r.id !== id);

  // Atualiza a tela
  renderBaseDados();
  renderAll(); // atualiza gráficos e KPIs
}

function exportarCSV(){
  if(!bdAllRows || bdAllRows.length === 0){ alert('Não há dados para exportar.'); return; }
  const campos = ['id','cliente','num_pedido','data_pedido','solicitante','descricao_empresa','qtd_pedido','data_entrega','status','valor','empresa','nf_numero_original'];
  const cabecalho = ['ID','Cliente','Nº Pedido','Data Pedido','Solicitante','Descrição (Empresa)','Qtd Pedido','Data Entrega','Status','Valor (R$)','Empresa','NF'];
  const linhas = [cabecalho.join(';')];
  bdAllRows.forEach(p => {
    const linha = campos.map(c => {
      const v = p[c] ?? '';
      return `"${String(v).replace(/"/g,'""')}"`;
    });
    linhas.push(linha.join(';'));
  });
  const csvContent = '\uFEFF' + linhas.join('\n'); // BOM para Excel reconhecer UTF-8
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `projetos_beaz_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
const modalOverlay = document.getElementById('modal-overlay');
const projetoForm = document.getElementById('projeto-form');
document.getElementById('btn-add-projeto').addEventListener('click', () => openNewModal());
document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if(e.target===modalOverlay) closeModal(); });

function openNewModal(){
  projetoForm.reset();
  document.getElementById('f-id').value = '';
  document.getElementById('modal-title').textContent = 'Novo Projeto';
  document.getElementById('modal-sub').textContent = 'PREENCHA OS CAMPOS ABAIXO';
  document.getElementById('btn-save-modal').textContent = 'Salvar Projeto';
  modalOverlay.classList.add('open');
}
async function openEditModal(id){
  const { data, error } = await db.from('projetos').select('*').eq('id', id).single();
  if(error || !data){ alert('Não foi possível carregar este projeto.'); return; }
  document.getElementById('modal-title').textContent = 'Editar Projeto';
  document.getElementById('modal-sub').textContent = `ID ${data.id} · ÚLTIMA ATUALIZAÇÃO ${data.atualizado_em ? new Date(data.atualizado_em).toLocaleString('pt-BR') : '—'}`;
  document.getElementById('btn-save-modal').textContent = 'Salvar Alterações';
  document.getElementById('f-id').value = data.id;
  document.getElementById('f-cliente').value = data.cliente||'';
  document.getElementById('f-num-pedido').value = data.num_pedido||'';
  document.getElementById('f-data-pedido').value = data.data_pedido||'';
  document.getElementById('f-solicitante').value = data.solicitante||'';
  document.getElementById('f-descricao-empresa').value = data.descricao_empresa||'';
  document.getElementById('f-qtd-pedido').value = data.qtd_pedido ?? '';
  document.getElementById('f-data-entrega').value = data.data_entrega||'';
  document.getElementById('f-status').value = data.status||'DIGITAR PEDIDO';
  document.getElementById('f-valor').value = data.valor ?? '';
  document.getElementById('f-empresa').value = data.empresa||'';
  document.getElementById('f-nf').value = data.nf_numero_original||'';
  modalOverlay.classList.add('open');
}
function closeModal(){ modalOverlay.classList.remove('open'); document.getElementById('save-feedback').style.display='none'; }

projetoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('f-id').value;
  const feedback = document.getElementById('save-feedback');
  const saveBtn = document.getElementById('btn-save-modal');
  const payload = {
    cliente: document.getElementById('f-cliente').value.trim()||null,
    num_pedido: document.getElementById('f-num-pedido').value.trim()||null,
    data_pedido: document.getElementById('f-data-pedido').value||null,
    solicitante: document.getElementById('f-solicitante').value.trim()||null,
    descricao_empresa: document.getElementById('f-descricao-empresa').value.trim()||null,
    qtd_pedido: document.getElementById('f-qtd-pedido').value ? parseFloat(document.getElementById('f-qtd-pedido').value) : null,
    data_entrega: document.getElementById('f-data-entrega').value||null,
    status: document.getElementById('f-status').value,
    valor: parseMoeda(document.getElementById('f-valor').value),
    empresa: document.getElementById('f-empresa').value.trim()||null,
    nf_numero_original: document.getElementById('f-nf').value.trim()||null,
  };
  saveBtn.disabled = true; saveBtn.textContent = 'Salvando...';
  let error;
  if(id){ ({error} = await db.from('projetos').update(payload).eq('id', id)); }
  else { ({error} = await db.from('projetos').insert(payload)); }
  saveBtn.disabled = false; saveBtn.textContent = id ? 'Salvar Alterações' : 'Salvar Projeto';
  if(error){
    feedback.textContent = 'Erro ao salvar: '+error.message; feedback.style.color='var(--danger)'; feedback.style.display='block';
    return;
  }
  feedback.textContent = 'Salvo com sucesso!'; feedback.style.color='var(--ok)'; feedback.style.display='block';
  setTimeout(() => {
    closeModal();
    loadDashboard();
    if(document.getElementById('tab-basedados').classList.contains('active')) loadBaseDados();
  }, 700);
});

/* ============================================================
   ABA "NOTAS FISCAIS" — grade com scroll, ordenação, edição,
   exclusão, exportar CSV e modal de cadastro
   ============================================================ */
let nfAllRows = [];
let nfSort = { field: 'data_emissao', dir: 'desc' };

document.getElementById('nf-btn-add').addEventListener('click', () => openNewNFModal());
document.getElementById('nf-btn-cancel').addEventListener('click', closeNFModal);
document.getElementById('nf-modal-overlay').addEventListener('click', (e) => { if(e.target===document.getElementById('nf-modal-overlay')) closeNFModal(); });

// Máscara de moeda no campo valor do modal NF
aplicarMascaraMoeda(document.getElementById('nf-f-valor'));

let nfSearchTimeout = null;
document.getElementById('nf-search-input').addEventListener('input', () => {
  clearTimeout(nfSearchTimeout);
  nfSearchTimeout = setTimeout(() => renderNotasFiscais(), 250);
});

document.querySelectorAll('.nf-sortable-th').forEach(th => {
  th.addEventListener('click', () => {
    const field = th.dataset.field;
    if(nfSort.field === field){
      nfSort.dir = nfSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      nfSort = { field, dir: 'asc' };
    }
    document.querySelectorAll('.nf-sortable-th .sort-arrow-nf').forEach(a => a.textContent = '');
    th.querySelector('.sort-arrow-nf').textContent = nfSort.dir === 'asc' ? '▲' : '▼';
    renderNotasFiscais();
  });
});

async function loadNotasFiscais(){
  const tbody = document.getElementById('nf-tbody');
  tbody.innerHTML = `<tr><td colspan="9" class="loading-inline">Carregando notas fiscais...</td></tr>`;
  try {
    nfAllRows = await fetchAllRows('notas_fiscais', 'id, valor, data_emissao, cliente, nf_numero, tipo_nota, descricao, qtd_entregue, empresa, num_pedido');
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Erro ao carregar: ${err.message}</td></tr>`;
    return;
  }
  renderNotasFiscais();
}

function renderNotasFiscais(){
  const tbody = document.getElementById('nf-tbody');
  const search = document.getElementById('nf-search-input').value.trim().toLowerCase();

  let rows = nfAllRows;
  if(search){
    rows = rows.filter(n =>
      (n.cliente||'').toLowerCase().includes(search) ||
      String(n.nf_numero||'').toLowerCase().includes(search)
    );
  }

  rows = [...rows].sort((a,b) => {
    let va = a[nfSort.field], vb = b[nfSort.field];
    if(nfSort.field === 'valor'){ va = va||0; vb = vb||0; }
    else { va = (va===null||va===undefined) ? '' : String(va); vb = (vb===null||vb===undefined) ? '' : String(vb); }
    if(va < vb) return nfSort.dir === 'asc' ? -1 : 1;
    if(va > vb) return nfSort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  if(rows.length === 0){
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Nenhuma nota fiscal encontrada.</td></tr>`;
    return;
  }

  const tiposNota = ['Venda','Remessa','Devolução','Serviço','Outro'];
  const empresas = ['BeaZ','We Americana'];

  tbody.innerHTML = rows.map(n => `
    <tr data-id="${n.id}">
      <td>
        <button class="edit-pencil" onclick="toggleNFRowEdit(${n.id}, this)" title="Editar linha">✎</button>
        <button class="edit-pencil" onclick="deleteNFRow(${n.id})" title="Apagar NF" style="margin-left:4px; color:var(--danger); border-color:var(--danger);">🗑</button>
        <span class="save-indicator">✓ salvo</span>
      </td>
      <td><input class="inline-input" disabled data-field="cliente" value="${escapeHtml(n.cliente||'')}"></td>
      <td><input class="inline-input" disabled data-field="nf_numero" value="${escapeHtml(String(n.nf_numero||''))}"></td>
      <td><input class="inline-input" disabled type="date" data-field="data_emissao" value="${n.data_emissao||''}"></td>
      <td>
        <select class="inline-select" disabled data-field="tipo_nota">
          ${tiposNota.map(t => `<option value="${t}" ${n.tipo_nota===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </td>
      <td><input class="inline-input" disabled data-field="descricao" value="${escapeHtml(n.descricao||'')}"></td>
      <td><input class="inline-input" disabled type="number" step="0.01" data-field="qtd_entregue" value="${n.qtd_entregue??''}"></td>
      <td style="display:flex; align-items:center; gap:4px;"><span style="color:var(--text-muted); font-size:11px;">R$</span><input class="inline-input" disabled type="number" step="0.01" data-field="valor" value="${n.valor??''}"></td>
      <td>
        <select class="inline-select" disabled data-field="empresa">
          ${empresas.map(e => `<option value="${e}" ${n.empresa===e?'selected':''}>${e}</option>`).join('')}
        </select>
      </td>
    </tr>
  `).join('');
}

function toggleNFRowEdit(id, btn){
  const tr = btn.closest('tr');
  const inputs = tr.querySelectorAll('[data-field]');
  const isEditing = btn.classList.contains('editing');
  if(!isEditing){
    inputs.forEach(i => i.disabled = false);
    btn.classList.add('editing');
    btn.textContent = '💾';
    btn.title = 'Salvar alterações';
  } else {
    saveNFRow(id, tr, btn);
  }
}

async function saveNFRow(id, tr, btn){
  const inputs = tr.querySelectorAll('[data-field]');
  const payload = {};
  inputs.forEach(input => {
    let value = input.value.trim ? input.value.trim() : input.value;
    if(['valor','qtd_entregue'].includes(input.dataset.field)) value = value === '' ? null : parseFloat(value);
    if(value === '') value = null;
    payload[input.dataset.field] = value;
  });
  btn.disabled = true;
  const { error } = await db.from('notas_fiscais').update(payload).eq('id', id);
  btn.disabled = false;
  if(error){ alert('Erro ao salvar: ' + error.message); return; }
  inputs.forEach(i => i.disabled = true);
  btn.classList.remove('editing');
  btn.textContent = '✎';
  btn.title = 'Editar linha';
  const indicator = tr.querySelector('.save-indicator');
  indicator.classList.add('show');
  setTimeout(() => indicator.classList.remove('show'), 1500);
  const idx = nfAllRows.findIndex(r => r.id === id);
  if(idx > -1) nfAllRows[idx] = { ...nfAllRows[idx], ...payload };
  // Atualiza allNFs e gráficos
  const idx2 = allNFs.findIndex(r => r.id === id);
  if(idx2 > -1) allNFs[idx2] = { ...allNFs[idx2], ...payload };
  renderAll();
}

async function deleteNFRow(id){
  if(!confirm('Tem certeza que deseja apagar esta Nota Fiscal? Esta ação não pode ser desfeita.')) return;
  const { error } = await db.from('notas_fiscais').delete().eq('id', id);
  if(error){ alert('Erro ao apagar: ' + error.message); return; }
  const { data: check } = await db.from('notas_fiscais').select('id').eq('id', id).single();
  if(check){ alert('Não foi possível apagar este registro. Verifique as permissões no Supabase (RLS).'); return; }
  nfAllRows = nfAllRows.filter(r => r.id !== id);
  allNFs = allNFs.filter(r => r.id !== id);
  renderNotasFiscais();
  renderAll();
}

function exportarCSVNotas(){
  if(!nfAllRows || nfAllRows.length === 0){ alert('Não há dados para exportar.'); return; }
  const campos = ['id','cliente','nf_numero','data_emissao','tipo_nota','descricao','qtd_entregue','valor','empresa','num_pedido'];
  const cabecalho = ['ID','Cliente','Nº NF','Data Emissão','Tipo','Descrição','Qtd Entregue','Valor (R$)','Empresa','Nº Pedido Ref.'];
  const linhas = [cabecalho.join(';')];
  nfAllRows.forEach(n => {
    const linha = campos.map(c => {
      const v = n[c] ?? '';
      return `"${String(v).replace(/"/g,'""')}"`;
    });
    linhas.push(linha.join(';'));
  });
  const csvContent = '\uFEFF' + linhas.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `notas_fiscais_beaz_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function openNewNFModal(){
  document.getElementById('nf-form').reset();
  document.getElementById('nf-f-id').value = '';
  document.getElementById('nf-modal-title').textContent = 'Nova Nota Fiscal';
  document.getElementById('nf-modal-sub').textContent = 'PREENCHA OS CAMPOS ABAIXO';
  document.getElementById('nf-btn-save').textContent = 'Salvar NF';
  document.getElementById('nf-modal-overlay').classList.add('open');
}
async function openEditNFModal(id){
  const { data, error } = await db.from('notas_fiscais').select('*').eq('id', id).single();
  if(error || !data){ alert('Não foi possível carregar esta NF.'); return; }
  document.getElementById('nf-modal-title').textContent = 'Editar Nota Fiscal';
  document.getElementById('nf-modal-sub').textContent = `ID ${data.id}`;
  document.getElementById('nf-btn-save').textContent = 'Salvar Alterações';
  document.getElementById('nf-f-id').value = data.id;
  document.getElementById('nf-f-cliente').value = data.cliente||'';
  document.getElementById('nf-f-numero').value = data.nf_numero||'';
  document.getElementById('nf-f-data-emissao').value = data.data_emissao||'';
  document.getElementById('nf-f-tipo').value = data.tipo_nota||'Venda';
  document.getElementById('nf-f-descricao').value = data.descricao||'';
  document.getElementById('nf-f-qtd').value = data.qtd_entregue??'';
  // Formata valor para máscara
  if(data.valor != null){
    const v = data.valor.toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
    document.getElementById('nf-f-valor').value = v;
  } else {
    document.getElementById('nf-f-valor').value = '';
  }
  document.getElementById('nf-f-empresa').value = data.empresa||'BeaZ';
  document.getElementById('nf-f-num-pedido').value = data.num_pedido||'';
  document.getElementById('nf-modal-overlay').classList.add('open');
}
function closeNFModal(){
  document.getElementById('nf-modal-overlay').classList.remove('open');
  document.getElementById('nf-save-feedback').style.display='none';
}

document.getElementById('nf-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('nf-f-id').value;
  const feedback = document.getElementById('nf-save-feedback');
  const saveBtn = document.getElementById('nf-btn-save');
  const payload = {
    cliente: document.getElementById('nf-f-cliente').value.trim()||null,
    nf_numero: document.getElementById('nf-f-numero').value.trim()||null,
    data_emissao: document.getElementById('nf-f-data-emissao').value||null,
    tipo_nota: document.getElementById('nf-f-tipo').value||null,
    descricao: document.getElementById('nf-f-descricao').value.trim()||null,
    qtd_entregue: document.getElementById('nf-f-qtd').value ? parseFloat(document.getElementById('nf-f-qtd').value) : null,
    valor: parseMoeda(document.getElementById('nf-f-valor').value),
    empresa: document.getElementById('nf-f-empresa').value||null,
    num_pedido: document.getElementById('nf-f-num-pedido').value.trim()||null,
  };
  saveBtn.disabled = true; saveBtn.textContent = 'Salvando...';
  let error;
  if(id){ ({error} = await db.from('notas_fiscais').update(payload).eq('id', id)); }
  else { ({error} = await db.from('notas_fiscais').insert(payload)); }
  saveBtn.disabled = false; saveBtn.textContent = id ? 'Salvar Alterações' : 'Salvar NF';
  if(error){
    feedback.textContent = 'Erro ao salvar: '+error.message; feedback.style.color='var(--danger)'; feedback.style.display='block';
    return;
  }
  feedback.textContent = 'Salvo com sucesso!'; feedback.style.color='var(--ok)'; feedback.style.display='block';
  setTimeout(() => {
    closeNFModal();
    loadDashboard();
    if(document.getElementById('tab-notas').classList.contains('active')) loadNotasFiscais();
  }, 700);
});

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
checkSession();
