const $ = (s) => document.querySelector(s);

const giftsGrid = $("#giftsGrid");
const searchInput = $("#searchInput");
const resultsCount = $("#resultsCount");

// Modal elements
const pixModal = $("#pixModal");
const qrCodeBox = $("#qrCode");
const pixPayload = $("#pixPayload");
const pixSubtitle = $("#pixSubtitle");
const copyBtn = $("#copyBtn");
const whatsBtn = $("#whatsBtn");

let gifts = [];
let currentGift = null;

init();

async function init() {
  // Close modal handlers
  pixModal.addEventListener("click", (e) => {
    if (e.target.matches("[data-close]")) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && pixModal.getAttribute("aria-hidden") === "false") closeModal();
  });

  // Load gifts
  gifts = await fetch("./gifts.json").then(r => r.json());
  render(gifts);

  // Search
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = gifts.filter(g =>
      (g.title || "").toLowerCase().includes(q) ||
      (g.description || "").toLowerCase().includes(q)
    );
    render(filtered);
  });

  // Copy
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(pixPayload.value);
      copyBtn.textContent = "Copiado!";
      setTimeout(() => (copyBtn.textContent = "Copiar código"), 1200);
    } catch {
      alert("Não consegui copiar automaticamente. Selecione e copie manualmente.");
    }
  });
}

function render(list) {
  resultsCount.textContent = `${list.length} item(ns)`;
  giftsGrid.innerHTML = "";

  list.forEach(g => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="card__img">
        <img src="${escapeHtml(g.image)}" alt="${escapeHtml(g.title)}">
      </div>
      <div class="card__body">
        <h3 class="card__title">${escapeHtml(g.title)}</h3>
        <p class="card__desc">${escapeHtml(g.description || "")}</p>

        <div class="priceRow">
          <span class="price">${formatBRL(g.price)}</span>
          <button class="btn" data-open="${escapeHtml(g.id)}">Ver Pix</button>
        </div>
      </div>
    `;
    giftsGrid.appendChild(card);
  });

  giftsGrid.querySelectorAll("[data-open]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-open");
      const gift = gifts.find(x => x.id === id);
      openPix(gift);
    });
  });
}

function openPix(gift) {
  currentGift = gift;

  // Build Pix payload
  const payload = buildPixPayload({
    pixKey: gift.pixKey,
    merchantName: gift.merchantName,
    merchantCity: gift.merchantCity,
    amount: Number(gift.price).toFixed(2),
    description: gift.message || gift.title,
    txid: gift.id
  });

  // Fill UI
  pixSubtitle.textContent = `${gift.title} • ${formatBRL(gift.price)}`;
  pixPayload.value = payload;

  // WhatsApp prefilled message (troque o número no index.html também)
  const msg = encodeURIComponent(
    `Olá! Eu acabei de enviar o Pix do presente "${gift.title}" (${formatBRL(gift.price)}).\n` +
    `Meu nome é: ________\n` +
    `Mensagem: ________\n` +
    `Se precisar, posso mandar o comprovante aqui. 💛`
  );
  // Coloque seu número com DDI+DDD sem +, ex: 5511999999999
  whatsBtn.href = `https://wa.me/55SEUNUMEROAQUI?text=${msg}`;

  // Render QR
  qrCodeBox.innerHTML = "";
  // qrcodejs creates <img> or <canvas>
  new QRCode(qrCodeBox, {
    text: payload,
    width: 220,
    height: 220,
    correctLevel: QRCode.CorrectLevel.M
  });

  pixModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  pixModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

// ---------- Pix BR Code generator (EMV) ----------
// Helper: format EMV field "ID + length(2) + value"
function emv(id, value) {
  const len = String(value.length).padStart(2, "0");
  return `${id}${len}${value}`;
}

// CRC16/CCITT-FALSE
function crc16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function buildPixPayload({ pixKey, merchantName, merchantCity, amount, description, txid }) {
  // Merchant Account Information (ID 26)
  const gui = emv("00", "br.gov.bcb.pix");
  const key = emv("01", pixKey);
  const desc = description ? emv("02", sanitize(description, 70)) : "";
  const merchantAcc = emv("26", `${gui}${key}${desc}`);

  const payloadFormat = emv("00", "01");
  const initiationMethod = emv("01", "11"); // static

  const mcc = emv("52", "0000");
  const currency = emv("53", "986"); // BRL
  const amt = amount ? emv("54", String(amount)) : "";
  const country = emv("58", "BR");
  const name = emv("59", sanitize(merchantName, 25));
  const city = emv("60", sanitize(merchantCity, 15));

  // Additional Data Field Template (ID 62) with TXID (05)
  const tx = emv("05", sanitize(txid || "***", 25));
  const addData = emv("62", tx);

  // Build without CRC first
  const partial =
    `${payloadFormat}` +
    `${initiationMethod}` +
    `${merchantAcc}` +
    `${mcc}` +
    `${currency}` +
    `${amt}` +
    `${country}` +
    `${name}` +
    `${city}` +
    `${addData}` +
    "6304";

  const crc = crc16(partial);
  return partial + crc;
}

// ---------- utils ----------
function formatBRL(value) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function sanitize(str, maxLen) {
  // Pix fields prefer uppercase without special chars; keep it simple
  return String(str)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s\-.,]/g, "")
    .trim()
    .toUpperCase()
    .slice(0, maxLen);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
