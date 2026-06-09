const fs = require('fs');

const EMAIL_DESTINO = process.env.EMAIL_DESTINO;
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE;
const EMAIL_SENHA = process.env.EMAIL_SENHA;
const ARQUIVO_ESTADO = 'estado.json';
const BASE_URL = 'https://alepa.pa.gov.br/Legislativo/DetalhesProposicao';

// ID do PL nº 1/2026 — ponto de partida do primeiro run
const ID_INICIO_2026 = 15512;

// Tipos monitorados (todos os disponíveis na ALEPA)
const TIPOS_MONITORADOS = [
  'PROJETO DE LEI ORDINÁRIA',
  'PROJETO DE LEI COMPLEMENTAR',
  'PROJETO DE DECRETO LEGISLATIVO',
  'PROJETO DE EMENDA CONSTITUCIONAL',
  'PROJETO DE RESOLUÇÃO',
  'PROJETO DE INDICAÇÃO',
  'INDICAÇÃO',
  'REQUERIMENTO',
  'MOÇÃO',
  'PROCESSO',
];

// Emojis por tipo
const EMOJI_TIPO = {
  'PROJETO DE LEI ORDINÁRIA': '📋',
  'PROJETO DE LEI COMPLEMENTAR': '📙',
  'PROJETO DE DECRETO LEGISLATIVO': '📜',
  'PROJETO DE EMENDA CONSTITUCIONAL': '🏛️',
  'PROJETO DE RESOLUÇÃO': '📌',
  'PROJETO DE INDICAÇÃO': '📩',
  'INDICAÇÃO': '📩',
  'REQUERIMENTO': '📝',
  'MOÇÃO': '🗣️',
  'PROCESSO': '📂',
};

// Abreviações para o assunto do email
const ABREV_TIPO = {
  'PROJETO DE LEI ORDINÁRIA': 'PL',
  'PROJETO DE LEI COMPLEMENTAR': 'PLC',
  'PROJETO DE DECRETO LEGISLATIVO': 'PDL',
  'PROJETO DE EMENDA CONSTITUCIONAL': 'PEC',
  'PROJETO DE RESOLUÇÃO': 'PR',
  'PROJETO DE INDICAÇÃO': 'PI',
  'INDICAÇÃO': 'IND',
  'REQUERIMENTO': 'REQ',
  'MOÇÃO': 'MOÇ',
  'PROCESSO': 'PROC',
};

function carregarEstado() {
  if (fs.existsSync(ARQUIVO_ESTADO)) {
    return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
  }
  // Primeiro run: começa do ID_INICIO_2026 - 1 para pegar tudo de 2026
  return { ultimo_id_visto: ID_INICIO_2026 - 1, ultimos_por_tipo_ano: {}, ultima_execucao: '' };
}

function salvarEstado(estado) {
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function numeroInteiro(p) {
  const n = Number(String(p.numero || '').replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function chaveTipoAno(p) {
  return `${p.tipo || 'OUTROS'}|${p.ano || '-'}`;
}

function calcularUltimosPorTipoAno(proposicoes) {
  const ultimos = {};
  for (const p of proposicoes) {
    const numero = numeroInteiro(p);
    if (!numero || !p.ano || p.ano === '-') continue;
    const chave = chaveTipoAno(p);
    ultimos[chave] = Math.max(ultimos[chave] || 0, numero);
  }
  return ultimos;
}

function detectarSaltos(proposicoes, estado) {
  const anteriores = estado.ultimos_por_tipo_ano || {};
  const atuais = calcularUltimosPorTipoAno(proposicoes);
  const presentes = {};
  for (const p of proposicoes) {
    const numero = numeroInteiro(p);
    if (!numero) continue;
    const chave = chaveTipoAno(p);
    if (!presentes[chave]) presentes[chave] = new Set();
    presentes[chave].add(numero);
  }
  const alertas = [];
  for (const [chave, atual] of Object.entries(atuais)) {
    const anterior = Number(anteriores[chave] || 0);
    if (!anterior || atual <= anterior + 1) continue;
    const faltantes = [];
    for (let n = anterior + 1; n < atual; n++) {
      if (!presentes[chave]?.has(n)) faltantes.push(n);
    }
    if (faltantes.length) {
      const [tipo, ano] = chave.split('|');
      alertas.push({ tipo, ano, anterior, atual, faltantes });
    }
  }
  return { alertas, atuais };
}

function renderAlertasSaltos(alertas) {
  if (!alertas.length) return '';
  const itens = alertas.map(a => `<li><strong>${escapeHtml(a.tipo)} ${escapeHtml(a.ano)}</strong>: último visto ${a.anterior}, maior atual ${a.atual}. Possível(is) ausente(s): ${escapeHtml(a.faltantes.join(', '))}</li>`).join('');
  return `<div style="background:#fff4e5;border:1px solid #f59e0b;color:#7c2d12;padding:12px 14px;margin:12px 0;border-radius:4px"><strong>Alerta de sequência:</strong><ul style="margin:8px 0 0 18px;padding:0">${itens}</ul></div>`;
}

function extrairDados(html, id) {
  // Estrutura real: <p>Label: Valor</p>
  const extrair = (label) => {
    const regex = new RegExp(`<p>${label}:\\s*([^<]+)</p>`, 'i');
    const match = html.match(regex);
    return match ? match[1].trim() : '-';
  };

  const tipo = extrair('Tipo de Proposição');
  const numero = extrair('Número');
  const autor = extrair('Autor');
  const data = extrair('Data da Entrada');
  const ementa = extrair('Ementa');

  // Ano do breadcrumb: "PROJETO DE LEI ORDINÁRIA Nº 1/2026"
  let ano = '-';
  const anoMatch = html.match(/N[º°o]\s*\d+\/(\d{4})/i);
  if (anoMatch) ano = anoMatch[1];

  // URL do PDF se disponível
  const pdfMatch = html.match(/href="(https:\/\/downloads\.alepa\.pa\.gov\.br\/Projeto\/\d+\.PDF)"/i);
  const pdf = pdfMatch ? pdfMatch[1] : null;

  return {
    id: String(id),
    tipo: tipo.toUpperCase(),
    numero,
    ano,
    autor: autor.length > 50 ? autor.substring(0, 50) + '…' : autor,
    data,
    ementa: ementa.replace(/\s+/g, ' ').trim() || '-',
    link: `${BASE_URL}?IdProposicao=${id}`,
    pdf,
  };
}

async function buscarProposicao(id) {
  const url = `${BASE_URL}?IdProposicao=${id}`;
  let response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Monitor-ALEPA/1.0)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.error(`   ⚠️ Timeout/erro de conexão no ID ${id}: ${err.message}`);
    return null; // null = erro de rede, não significa que não existe
  }

  if (response.status === 500 || response.status === 404) {
    return false; // false = ID não existe
  }

  if (!response.ok) {
    console.error(`   ⚠️ Status inesperado ${response.status} para ID ${id}`);
    return null;
  }

  const html = await response.text();

  // Verifica se é página de proposição válida
  if (!html.includes('Detalhes da Proposição') && !html.includes('Tipo de Proposição')) {
    return false;
  }

  return extrairDados(html, id);
}


const CLIENTES_NOMES_PROPRIOS = [
  'FIRJAN', 'Red Bull', 'Sindicerv', 'Boticario', 'Boticário', 'Abrasel', 'ANBRASEL',
  'Energisa', 'EnergisaLuz', 'SABESP', 'COMGAS', 'COMGÁS', 'Eletromidia', 'Eletromídia',
  'BRT', 'Regenera', 'Nova Infra', 'Seta', 'SETA', 'AkzoNobel', 'Expedia', 'RTSC',
  'Huawei', 'Carrefour', 'JBS', 'Ajinomoto', 'Vibra', 'Mindlab', 'ABVTEX', 'Neoenergia', 'ENEL'
];

function clientesCitadosNaProposicao(p) {
  const texto = [p.cliente, p.clientes, p.autor, p.autores, p.tipo, p.rotulo, p.titulo, p.identificacao, p.ementa]
    .filter(Boolean)
    .join(' ');
  const achados = [];
  for (const nome of CLIENTES_NOMES_PROPRIOS) {
    const escaped = nome.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[^A-Za-zÀ-ÿ0-9])' + escaped + '([^A-Za-zÀ-ÿ0-9]|$)', 'i');
    if (re.test(texto) && !achados.some(a => a.toLowerCase() === nome.toLowerCase())) achados.push(nome);
  }
  return achados;
}

function anotarClientesCitados(proposicoes) {
  for (const p of proposicoes || []) {
    const clientes = clientesCitadosNaProposicao(p);
    p.clientesCitados = clientes;
    if (clientes.length && p.ementa && !String(p.ementa).includes('Cliente citado:')) {
      p.ementa = String(p.ementa).trim() + ' | Cliente citado: ' + clientes.join(', ');
    }
  }
}

async function enviarEmail(novas, alertas = []) {
  anotarClientesCitados(novas);
  if (process.env.DRY_RUN_EMAIL === '1') {
    console.log(`[DRY_RUN_EMAIL] ${novas.length} proposições novas.`);
    alertas.forEach(a => console.log(`[ALERTA_SEQUENCIA] ${a.tipo}/${a.ano}: ${a.anterior} -> ${a.atual}; faltantes: ${a.faltantes.join(', ')}`));
    return;
  }
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_REMETENTE, pass: EMAIL_SENHA },
  });

  const porTipo = {};
  novas.forEach(p => {
    const tipo = p.tipo || 'OUTROS';
    if (!porTipo[tipo]) porTipo[tipo] = [];
    porTipo[tipo].push(p);
  });

  // Ordem de exibição: PLs primeiro, depois resto alfabético
  const ORDEM_TIPOS = [
    'PROJETO DE LEI ORDINÁRIA',
    'PROJETO DE LEI COMPLEMENTAR',
    'PROJETO DE EMENDA CONSTITUCIONAL',
    'PROJETO DE DECRETO LEGISLATIVO',
    'PROJETO DE RESOLUÇÃO',
    'PROJETO DE INDICAÇÃO',
    'INDICAÇÃO',
    'REQUERIMENTO',
    'MOÇÃO',
    'PROCESSO',
  ];

  const tiposOrdenados = Object.keys(porTipo).sort((a, b) => {
    const ia = ORDEM_TIPOS.indexOf(a);
    const ib = ORDEM_TIPOS.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const linhas = tiposOrdenados.map(tipo => {
    const emoji = EMOJI_TIPO[tipo] || '📄';
    const header = `<tr><td colspan="4" style="padding:10px 8px 4px;background:#f0f4f8;font-weight:bold;color:#1a3a5c;font-size:13px;border-top:2px solid #1a3a5c">${emoji} ${tipo} — ${porTipo[tipo].length} proposição(ões)</td></tr>`;
    const rows = porTipo[tipo]
      .sort((a, b) => parseInt(b.numero) - parseInt(a.numero))
      .map(p => {
        const abrev = ABREV_TIPO[p.tipo] || p.tipo;
        const linkTexto = `${abrev} ${p.numero}/${p.ano}`;
        const linkHref = p.pdf || p.link;
        const linkExtra = p.pdf
          ? ` <a href="${p.link}" style="color:#888;font-size:10px" target="_blank">[página]</a>`
          : '';
        return `<tr>
          <td style="padding:8px;border-bottom:1px solid #eee;white-space:nowrap">
            <strong><a href="${linkHref}" style="color:#1a3a5c;text-decoration:none" target="_blank">${linkTexto}</a></strong>${linkExtra}
          </td>
          <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.autor}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap">${p.data}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.ementa}</td>
        </tr>`;
      }).join('');
    return header + rows;
  }).join('');

  // Resumo por tipo para o topo do email
  const resumo = tiposOrdenados.map(tipo => {
    const emoji = EMOJI_TIPO[tipo] || '📄';
    const abrev = ABREV_TIPO[tipo] || tipo;
    return `<span style="margin-right:16px">${emoji} <strong>${abrev}</strong>: ${porTipo[tipo].length}</span>`;
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:960px;margin:0 auto">
      <h2 style="color:#1a3a5c;border-bottom:3px solid #1a3a5c;padding-bottom:8px">
        🏛️ Assembleia Legislativa do Pará — ${novas.length} nova(s) proposição(ões)
      </h2>
      <p style="color:#666;margin-top:0">${new Date().toLocaleString('pt-BR', { timeZone: 'America/Belem' })} (horário de Belém)</p>
      <div style="background:#f8f9fa;padding:10px 14px;border-radius:6px;margin-bottom:16px;font-size:13px">
        ${resumo}
      </div>
      ${renderAlertasSaltos(alertas)}
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#1a3a5c;color:white">
            <th style="padding:10px;text-align:left;white-space:nowrap">Proposição</th>
            <th style="padding:10px;text-align:left">Autor</th>
            <th style="padding:10px;text-align:left">Data</th>
            <th style="padding:10px;text-align:left">Ementa</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#999">
        🔗 Portal: <a href="https://alepa.pa.gov.br/Home/Page/Proposicoes" style="color:#1a3a5c">alepa.pa.gov.br/Home/Page/Proposicoes</a>
      </p>
    </div>
  `;

  // Assunto resumido com tipos
  const resumoAssunto = tiposOrdenados
    .map(t => `${ABREV_TIPO[t] || t}:${porTipo[t].length}`)
    .join(' ');

  await transporter.sendMail({
    from: `"Monitor Pará" <${EMAIL_REMETENTE}>`,
    to: EMAIL_DESTINO,
    subject: `🏛️ Pará: ${novas.length} nova(s) proposição(ões)${alertas.length ? ' | alerta sequência' : ''} — ${resumoAssunto} — ${new Date().toLocaleDateString('pt-BR')}`,
    html,
  });

  console.log(`✅ Email enviado com ${novas.length} proposições novas.`);
}

(async () => {
  console.log('🚀 Iniciando monitor ALEPA (Pará)...');
  console.log(`⏰ ${new Date().toLocaleString('pt-BR')}`);

  const estado = carregarEstado();
  let ultimoId = estado.ultimo_id_visto;
  console.log(`📌 Último ID visto: ${ultimoId}`);

  const novas = [];
  let id = ultimoId + 1;
  let errosConsecutivos = 0;
  const MAX_ERROS = 5; // Para após 5 erros de rede consecutivos
  const MAX_VAZIOS_CONSECUTIVOS = 10; // Para após 10 IDs inexistentes consecutivos
  let vaziosConsecutivos = 0;

  console.log(`🔍 Varrendo a partir do ID ${id}...`);

  while (true) {
    const resultado = await buscarProposicao(id);

    if (resultado === null) {
      // Erro de rede — não avança o estado
      errosConsecutivos++;
      if (errosConsecutivos >= MAX_ERROS) {
        console.error(`❌ ${MAX_ERROS} erros consecutivos de rede. Encerrando.`);
        break;
      }
      id++;
      continue;
    }

    errosConsecutivos = 0;

    if (resultado === false) {
      // ID não existe
      vaziosConsecutivos++;
      console.log(`   ID ${id} — não existe (${vaziosConsecutivos}/${MAX_VAZIOS_CONSECUTIVOS})`);
      if (vaziosConsecutivos >= MAX_VAZIOS_CONSECUTIVOS) {
        console.log(`✅ ${MAX_VAZIOS_CONSECUTIVOS} IDs vazios consecutivos. Fim da varredura.`);
        break;
      }
      id++;
      continue;
    }

    // Proposição encontrada
    vaziosConsecutivos = 0;
    ultimoId = id;
    console.log(`   ✅ ID ${id} — ${resultado.tipo} ${resultado.numero}/${resultado.ano} — ${resultado.autor}`);
    novas.push(resultado);
    id++;

    // Pausa pequena para não sobrecarregar o servidor
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n📊 Total de proposições novas encontradas: ${novas.length}`);
  const { alertas, atuais } = detectarSaltos(novas, estado);
  if (process.env.DRY_RUN_EMAIL === '1' && novas.length === 0) {
    await enviarEmail([], alertas);
    console.log('DRY_RUN_EMAIL=1 — estado preservado sem alterações.');
    return;
  }

  if (novas.length > 0) {
    // Filtra apenas tipos monitorados para o email
    // (mantém todas no estado para não reprocessar)
    const paraEmail = novas.filter(p =>
      TIPOS_MONITORADOS.some(t => p.tipo.includes(t) || t.includes(p.tipo))
    );

    console.log(`📧 Proposições para o email: ${paraEmail.length}`);

    if (process.env.DRY_RUN_EMAIL === '1') {
      await enviarEmail(paraEmail, alertas);
      console.log('DRY_RUN_EMAIL=1 — estado preservado sem alterações.');
      return;
    }

    if (paraEmail.length > 0 || alertas.length > 0) {
      await enviarEmail(paraEmail, alertas);
    } else {
      console.log('ℹ️ Nenhuma proposição dos tipos monitorados. Email não enviado.');
    }

    estado.ultimo_id_visto = ultimoId;
  } else {
    console.log('✅ Sem novidades. Nada a enviar.');
  }

  estado.ultimos_por_tipo_ano = { ...(estado.ultimos_por_tipo_ano || {}), ...atuais };
  estado.ultima_execucao = new Date().toISOString();
  salvarEstado(estado);
})();
