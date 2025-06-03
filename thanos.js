import { ethers } from "ethers";
import axios from "axios";
import 'dotenv/config'; 
import chalk from 'chalk'; 

// --- Telegram Reporter (Modul Internal) ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

function logTelegramReporter(message, type = "info") {
    const timestamp = new Date().toLocaleTimeString('id-ID', {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    let levelPrefix; let coloredMessage = message; let icon = "";
    switch (type.toUpperCase()) {
        case "INFO": levelPrefix = chalk.blue.bold(`[T-INFO]`); coloredMessage = chalk.white(message); break;
        case "SUCCESS": icon = chalk.greenBright("✔ "); levelPrefix = chalk.green.bold(`[T-SUCCESS]`); coloredMessage = chalk.greenBright(message); break;
        case "ERROR": icon = chalk.redBright("✖ "); levelPrefix = chalk.red.bold(`[T-ERROR]`); coloredMessage = chalk.redBright.bold(message); break;
        case "WARN": levelPrefix = chalk.yellow.bold(`[T-WARN]`); coloredMessage = chalk.yellow(message); break;
        case "DEBUG": levelPrefix = chalk.magenta.bold(`[T-DEBUG]`); coloredMessage = chalk.magenta(message); break;
        default: levelPrefix = chalk.gray.bold(`[T-${type.toUpperCase()}]`); coloredMessage = chalk.gray(message);
    }
    const finalLog = `${chalk.dim.gray(`[${timestamp}]`)} ${levelPrefix} ${icon}${coloredMessage}`;
    if (type.toUpperCase() === "ERROR") { console.error(finalLog); } else { console.log(finalLog); }
}

async function sendTelegramMessage(message, parseMode = 'HTML') {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        logTelegramReporter('TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID tidak diatur di .env. Notifikasi Telegram dinonaktifkan.', 'warn');
        return false;
    }

    try {
        const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: parseMode
        }, {
            timeout: 10000 
        });

        if (response.data.ok) {
            logTelegramReporter('Pesan berhasil dikirim ke Telegram.', 'success');
            return true;
        } else {
            logTelegramReporter(`Gagal mengirim pesan ke Telegram: ${JSON.stringify(response.data)}`, 'error');
            return false;
        }
    } catch (error) {
        let errorMessage = `Terjadi kesalahan saat mengirim pesan ke Telegram: ${error.message}`;
        if (error.response && error.response.data) {
            errorMessage += ` | Detail: ${JSON.stringify(error.response.data)}`;
        }
        logTelegramReporter(errorMessage, 'error');
        return false;
    }
}
// --- Akhir Telegram Reporter ---


// --- Konfigurasi Hardcoded & Environment ---
const SWAP_REPETITIONS = 10; 
const RPC_URL = process.env.RPC_URL || "https://0g-testnet-rpc.astrostake.xyz";
const THE_PRIVATE_KEY = process.env.PRIVATE_KEY;

const INITIAL_USDT_TO_LOP_SWAPS = 3; 
const MIN_LOP_FOR_LOP_TO_USDT_SWAP = 0.5; 
const MIN_LOP_AMOUNT_TO_SWAP = 0.1; 
const MAX_LOP_PERCENTAGE_TO_SWAP = 0.5; 
const MAX_ABSOLUTE_LOP_TO_SWAP = 0.5; 

// --- Alamat Kontrak & API ---
const USDT_ADDRESS = "0xe6c489B6D3eecA451D60cfda4782e9E727490477";
const LOP_ADDRESS = "0x8b1b701966cfdd5021014bc9c18402b38091b7a8";
const ROUTER_ADDRESS = "0xDCd7d05640Be92EC91ceb1c9eA18e88aFf3a6900";
const FAUCET_ADDRESS = "0xdE56D007B41a591C98dC71e896AD0a844356e584";
const API_BASE_URL = "https://trade-gpt-800267618745.herokuapp.com";

const isDebug = false; 

let nonceTracker = {};
let shouldStop = false;
let activeProcesses = 0;

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const ROUTER_ABI = [
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)"
];

const FAUCET_ABI = [
  { "inputs": [], "name": "requestTokens", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "lastRequest", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"}
];

const USER_AGENTS = [ 
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
];

// --- Utility Functions ---
function getShortAddress(address) {
  return address ? address.slice(0, 6) + "..." + address.slice(-4) : "N/A";
}

function getShortHash(hash) {
  return hash ? hash.slice(0, 6) + "..." + hash.slice(-4) : "N/A";
}

function addLog(message, type = "info") {
  if (type === "debug" && !isDebug) return;
  const timestamp = new Date().toLocaleTimeString('id-ID', { 
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' 
  });
  let levelPrefix; let coloredMessage = message; let icon = "";
  switch (type.toUpperCase()) {
    case "INFO": levelPrefix = chalk.blue.bold(`[INFO]   `); coloredMessage = chalk.white(message); break;
    case "SUCCESS": icon = chalk.greenBright("✔ "); levelPrefix = chalk.green.bold(`[SUCCESS]`); coloredMessage = chalk.greenBright(message); break;
    case "ERROR": icon = chalk.redBright("✖ "); levelPrefix = chalk.red.bold(`[ERROR]  `); coloredMessage = chalk.redBright.bold(message); break;
    case "WAIT": icon = chalk.yellowBright("🕒 "); levelPrefix = chalk.yellow.bold(`[WAIT]   `); coloredMessage = chalk.yellow(message); break;
    case "DEBUG": levelPrefix = chalk.magenta.bold(`[DEBUG]  `); coloredMessage = chalk.magenta(message); break;
    default: levelPrefix = chalk.gray.bold(`[${type.toUpperCase()}]`); coloredMessage = chalk.gray(message);
  }
  const walletTag = chalk.cyanBright('[Wallet]');
  const finalLog = `${chalk.dim.gray(`[${timestamp}]`)} ${levelPrefix} ${icon}${walletTag} ${coloredMessage}`;
  if (type.toUpperCase() === "ERROR") { console.error(finalLog); } else { console.log(finalLog); }
}

async function sleep(ms) {
  if (shouldStop) { addLog("Sleep interrupted.", "info"); return; }
  activeProcesses++;
  try {
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, ms);
      const checkStopInterval = setInterval(() => {
        if (shouldStop) { clearTimeout(timeout); clearInterval(checkStopInterval); resolve(); }
      }, 200);
      if (timeout.unref) { timeout.unref(); }
      setTimeout(() => clearInterval(checkStopInterval), ms);
    });
  } finally { activeProcesses = Math.max(0, activeProcesses - 1); }
}

// --- Network & Blockchain Interaction ---
function getProvider() {
    try { return new ethers.JsonRpcProvider(RPC_URL); } catch (error) {
        addLog(`Failed to initialize provider: ${error.message}`, "error"); throw new Error("Failed to initialize provider.");
    }
}

function getApiHeaders(customHeaders = {}) {
  const userAgent = USER_AGENTS[0]; 
  return {
    "Accept": "*/*", "Accept-Encoding": "gzip, deflate, br", "Connection": "keep-alive",
    "User-Agent": userAgent, "Origin": "https://0g.app.tradegpt.finance",
    "Referer": "https://0g.app.tradegpt.finance/", ...customHeaders
  };
}

async function makeApiRequest(method, url, data, customHeaders = {}, maxRetries = 3, retryDelay = 2000) {
  activeProcesses++; let lastError = null;
  try {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (shouldStop) { addLog(`API request to ${url} cancelled.`, "info"); throw new Error("Process stopped"); }
      try {
        const headers = getApiHeaders(customHeaders);
        const config = { method, url, data, headers, timeout: 20000 };
        if (isDebug && data) addLog(`Sending payload to ${url}: ${JSON.stringify(data, null, 2)}`, "debug");
        const response = await axios(config);
        if (isDebug) addLog(`Received response from ${url}: ${JSON.stringify(response.data, null, 2)}`, "debug");
        return response.data;
      } catch (error) {
        lastError = error; let errMsg = `Attempt ${attempt}/${maxRetries} API request to ${url} failed`;
        if (error.response) errMsg += `: HTTP ${error.response.status} - ${JSON.stringify(error.response.data || error.response.statusText)}`;
        else if (error.request) errMsg += `: No response received`; else errMsg += `: ${error.message}`;
        addLog(errMsg, "error");
        if (attempt < maxRetries) { addLog(`Retrying API in ${retryDelay/1000}s...`, "wait"); await sleep(retryDelay); }
      }
    }
    throw new Error(`API request to ${url} failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown API error'}`);
  } finally { activeProcesses = Math.max(0, activeProcesses - 1); }
}

async function fetchAccountBalances(provider, walletAddress) {
    try {
        const aogiBalanceRaw = await provider.getBalance(walletAddress);
        const usdtContract = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);
        const lopContract = new ethers.Contract(LOP_ADDRESS, ERC20_ABI, provider);
        const [usdtBalanceRaw, lopBalanceRaw, usdtDecimalsRaw, lopDecimalsRaw] = await Promise.all([
            usdtContract.balanceOf(walletAddress).catch(() => ethers.toBigInt(0)),
            lopContract.balanceOf(walletAddress).catch(() => ethers.toBigInt(0)),
            usdtContract.decimals().catch(() => 18), lopContract.decimals().catch(() => 18)
        ]);
        const usdtDecimals = Number(usdtDecimalsRaw); const lopDecimals = Number(lopDecimalsRaw);
        const aogiBalance = ethers.formatEther(aogiBalanceRaw);
        const usdtBalance = ethers.formatUnits(usdtBalanceRaw, usdtDecimals);
        const lopBalance = ethers.formatUnits(lopBalanceRaw, lopDecimals);
        const logMsg = `(${getShortAddress(walletAddress)}) Balances: AOGI: ${chalk.bold(parseFloat(aogiBalance).toFixed(4))}, USDT: ${chalk.bold(parseFloat(usdtBalance).toFixed(2))}, LOP: ${chalk.bold(parseFloat(lopBalance).toFixed(2))}`;
        addLog(logMsg, "info");
        return { aogiBalance, usdtBalance, lopBalance };
    } catch (error) {
        addLog(`(${getShortAddress(walletAddress)}): Failed to fetch balances: ${error.message}`, "error");
        return { aogiBalance: "0.00", usdtBalance: "0.00", lopBalance: "0.00" };
    }
}

async function getNextNonce(provider, walletAddress) {
  if (shouldStop) throw new Error("Process stopped, not fetching nonce.");
  try {
    const networkNonce = await provider.getTransactionCount(walletAddress, "pending");
    const lastUsedNonce = nonceTracker[walletAddress] || networkNonce - 1;
    const nextNonce = Math.max(networkNonce, lastUsedNonce + 1);
    nonceTracker[walletAddress] = nextNonce;
    addLog(`Nonce for ${getShortAddress(walletAddress)}: ${chalk.yellow(nextNonce)}`, "debug");
    return nextNonce;
  } catch (error) {
    addLog(`Error fetching nonce for ${getShortAddress(walletAddress)}: ${error.message}`, "error");
    try {
        const fallbackNonce = await provider.getTransactionCount(walletAddress, "latest");
        addLog(`Using fallback nonce for ${getShortAddress(walletAddress)}: ${chalk.yellow(fallbackNonce)}`, "warn");
        nonceTracker[walletAddress] = fallbackNonce; return fallbackNonce;
    } catch (e) { addLog(`Error fetching fallback nonce: ${e.message}`, "error"); throw e; }
  }
}

async function checkFaucetCooldown(wallet, provider) {
  try {
    const faucet = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, provider);
    const lastRequest = await faucet.lastRequest(wallet.address);
    const cooldown = BigInt(1 * 24 * 60 * 60); const currentTime = BigInt(Math.floor(Date.now() / 1000));
    const timeSinceLastRequest = currentTime - BigInt(lastRequest.toString());
    if (timeSinceLastRequest < cooldown) {
      const remainingSeconds = cooldown - timeSinceLastRequest;
      const hours = remainingSeconds / BigInt(3600); const minutes = (remainingSeconds % BigInt(3600)) / BigInt(60);
      return { canClaim: false, remaining: `${hours}h ${minutes}m` };
    } return { canClaim: true, remaining: "0h 0m" };
  } catch (error) {
    addLog(`Failed to check faucet cooldown: ${error.message}`, "error");
    return { canClaim: false, remaining: "Unknown" };
  }
}

async function claimFaucet(wallet, provider) {
  if (shouldStop) { addLog(`Faucet claim cancelled.`, "info"); return false; }
  const signer = wallet.connect(provider);
  const faucet = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, signer);
  addLog(`(${getShortAddress(wallet.address)}): Attempting to claim USDT faucet...`, "info");
  try {
    const nonce = await getNextNonce(provider, signer.address);
    const feeData = await provider.getFeeData();
    const txOverrides = {
        gasLimit: 300000n, nonce: nonce,
        maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1.5", "gwei"),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei")
    };
    if(!txOverrides.maxFeePerGas && !txOverrides.maxPriorityFeePerGas && feeData.gasPrice) {
      txOverrides.gasPrice = feeData.gasPrice; delete txOverrides.maxFeePerGas; delete txOverrides.maxPriorityFeePerGas;
    }
    const tx = await faucet.requestTokens(txOverrides);
    addLog(`Faucet claim tx sent. Hash: ${chalk.blueBright(getShortHash(tx.hash))}`, "success");
    await tx.wait(); 
    addLog(`Successfully claimed 100 USDT from faucet.`, "success"); 
    return true;
  } catch (error) {
    addLog(`Failed to claim faucet: ${error.message}`, "error");
    if (error.message.includes("nonce")) nonceTracker[wallet.address] = undefined; return false;
  }
}

async function checkAndApproveToken(wallet, provider, tokenAddress, amountInWei, tokenName, swapCount) {
  if (shouldStop) { addLog(`Approval for ${tokenName} cancelled.`, "info"); return false; }
  const signer = wallet.connect(provider);
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  addLog(`Swap ${swapCount}: Checking balance & allowance for ${chalk.yellow(tokenName)}...`, "debug");
  try {
    const balance = await token.balanceOf(signer.address);
    const tokenDecimals = await token.decimals().catch(() => 18);
    if (balance < amountInWei) {
      const errorMsg = `Swap ${swapCount}: Insufficient ${chalk.yellow(tokenName)} balance (${ethers.formatUnits(balance, Number(tokenDecimals))}). Needed: ${ethers.formatUnits(amountInWei, Number(tokenDecimals))}`;
      addLog(errorMsg, "error");
      return false;
    }
    const allowance = await token.allowance(signer.address, ROUTER_ADDRESS);
    if (allowance < amountInWei) {
      addLog(`Swap ${swapCount}: Approving ${chalk.yellow(tokenName)} for router. Allowance: ${ethers.formatUnits(allowance,Number(tokenDecimals))}, Need: ${ethers.formatUnits(amountInWei,Number(tokenDecimals))}`, "info");
      const nonce = await getNextNonce(provider, signer.address);
      const feeData = await provider.getFeeData();
      const txOverrides = {
        gasLimit: 100000n, nonce: nonce,
        maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1.5", "gwei"),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei")
      };
      if(!txOverrides.maxFeePerGas && !txOverrides.maxPriorityFeePerGas && feeData.gasPrice) {
        txOverrides.gasPrice = feeData.gasPrice; delete txOverrides.maxFeePerGas; delete txOverrides.maxPriorityFeePerGas;
      }
      const tx = await token.approve(ROUTER_ADDRESS, ethers.MaxUint256, txOverrides);
      addLog(`Swap ${swapCount}: Approval for ${chalk.yellow(tokenName)} sent. Hash: ${chalk.blueBright(getShortHash(tx.hash))}`, "success");
      await tx.wait(); 
      addLog(`Swap ${swapCount}: ${chalk.yellow(tokenName)} approved.`, "success");
    } else { addLog(`Swap ${swapCount}: Sufficient ${chalk.yellow(tokenName)} allowance present.`, "debug"); }
    return true;
  } catch (error) {
    addLog(`Swap ${swapCount}: Error approving/checking ${chalk.yellow(tokenName)}: ${error.message}`, "error");
    if (error.message.includes("nonce")) nonceTracker[wallet.address] = undefined; return false;
  }
}

function getSwapDetailsUsdtToLop() {
  const minUsdt = 5; const maxUsdt = 10;
  const amount = (Math.random() * (maxUsdt - minUsdt) + minUsdt).toFixed(2);
  addLog(`Preparing USDT -> LOP swap for ${chalk.yellow(amount + " USDT")}.`, "debug");
  return { 
    amountStr: amount.toString(), inToken: "USDT", outToken: "LOP", 
    inTokenAddress: USDT_ADDRESS, outTokenAddress: LOP_ADDRESS
  };
}

function getSwapDetailsLopToUsdt(currentLopBalance) {
  const numericLopBalance = parseFloat(currentLopBalance);
  if (isNaN(numericLopBalance) || numericLopBalance < MIN_LOP_AMOUNT_TO_SWAP) {
    addLog(`Saldo LOP tidak mencukupi (${numericLopBalance.toFixed(4)}) untuk LOP->USDT (min: ${MIN_LOP_AMOUNT_TO_SWAP}).`, "warn");
    return null;
  }
  let amountToSwap = Math.min( numericLopBalance * MAX_LOP_PERCENTAGE_TO_SWAP, MAX_ABSOLUTE_LOP_TO_SWAP );
  amountToSwap = Math.max(amountToSwap, MIN_LOP_AMOUNT_TO_SWAP);
  amountToSwap = Math.min(amountToSwap, numericLopBalance);
  if (amountToSwap < MIN_LOP_AMOUNT_TO_SWAP) {
      addLog(`Jumlah LOP yang akan di-swap (${amountToSwap.toFixed(4)}) terlalu kecil (min: ${MIN_LOP_AMOUNT_TO_SWAP}).`, "warn");
    return null;
  }
  const amountStr = amountToSwap.toFixed(4);
  addLog(`Preparing LOP -> USDT swap for ${chalk.yellow(amountStr + " LOP")}. Saldo LOP: ${numericLopBalance.toFixed(4)}`, "debug");
  return {
    amountStr: amountStr, inToken: "LOP", outToken: "USDT",
    inTokenAddress: LOP_ADDRESS, outTokenAddress: USDT_ADDRESS,
  };
}

async function sendSwapPrompt(walletAddress, amountStr, inToken, outToken) {
  const prompt = `Swap ${amountStr} ${inToken} to ${outToken}`;
  addLog(`Sending prompt to API: "${chalk.italic(prompt)}"`, "info");
  const payload = {
    chainId: 16601, user: walletAddress,
    questions: [{
        question: prompt, answer: "",
        baseMessage: { lc: 1, type: "constructor", id: ["langchain_core", "messages", "HumanMessage"], kwargs: { content: prompt, additional_kwargs: {}, response_metadata: {}}},
        type: null, priceHistorical: null, priceHistoricalData: null, isSynchronized: false, isFallback: false
    }], testnetOnly: true
  };
  try {
    const response = await makeApiRequest("post", `${API_BASE_URL}/ask/ask`, payload);
    if (response.questions && response.questions[0].answer) {
      const traderContent = response.questions[0].answer.find(a => a.type === "trader")?.content;
      if (traderContent) { addLog(`Received swap data from API.`, "debug"); return JSON.parse(traderContent); }
    }
    addLog(`Invalid API response for swap prompt. Resp: ${JSON.stringify(response)}`, "error");
    throw new Error("Invalid response from AI API for swap prompt");
  } catch (error) { addLog(`Failed to send/parse swap prompt: ${error.message}`, "error"); throw error; }
}

async function executeSwap(wallet, provider, swapApiData, swapCount, inTokenName, outTokenName, inTokenAddress) {
  if (shouldStop) { addLog(`Swap ${swapCount} cancelled.`, "info"); return null; }
  const signer = wallet.connect(provider);
  const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);
  addLog(`Swap ${swapCount}: Preparing to swap ${chalk.yellow(swapApiData.amount + " " + inTokenName)} for ${chalk.yellow(outTokenName)}.`, "info");
  try {
    const inTokenContract = new ethers.Contract(inTokenAddress, ERC20_ABI, provider);
    const inTokenDecimals = await inTokenContract.decimals().catch(() => 18);
    const amountIn = ethers.parseUnits(swapApiData.amount.toString(), Number(inTokenDecimals));
    if (!swapApiData.path || swapApiData.path.length < 2) {
        const errorMsg = `Swap ${swapCount}: Invalid path from API: ${swapApiData.path}`;
        addLog(errorMsg, "error"); 
        return null;
    }
    const outTokenAddressFromPath = swapApiData.path[swapApiData.path.length - 1];
    const outTokenContract = new ethers.Contract(outTokenAddressFromPath, ERC20_ABI, provider);
    const outTokenDecimals = await outTokenContract.decimals().catch(() => 18); 
    const amountOutMin = ethers.parseUnits(swapApiData.amountOutMin.toString(), Number(outTokenDecimals)); 
    const path = swapApiData.path; const to = signer.address; const deadline = Math.floor(Date.now() / 1000) + 600;
    const isApproved = await checkAndApproveToken(wallet, provider, inTokenAddress, amountIn, inTokenName, swapCount);
    if (!isApproved) { addLog(`Swap ${swapCount}: Approval failed/insufficient balance. Skipping.`, "warn"); return null; }
    addLog(`Swap ${swapCount}: Executing swap on router... (AmountIn: ${chalk.yellow(ethers.formatUnits(amountIn, Number(inTokenDecimals)) + " " + inTokenName)}, AmountOutMin: ${chalk.yellow(ethers.formatUnits(amountOutMin, Number(outTokenDecimals)) + " " + outTokenName)})`, "info");
    const nonce = await getNextNonce(provider, signer.address);
    const feeData = await provider.getFeeData();
    const txOverrides = {
        gasLimit: 300000n, nonce: nonce,
        maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1.5", "gwei"),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei")
    };
     if(!txOverrides.maxFeePerGas && !txOverrides.maxPriorityFeePerGas && feeData.gasPrice) {
        txOverrides.gasPrice = feeData.gasPrice; delete txOverrides.maxFeePerGas; delete txOverrides.maxPriorityFeePerGas;
    }
    const tx = await router.swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline, txOverrides);
    addLog(`Swap ${swapCount}: Tx sent. Hash: ${chalk.blueBright(getShortHash(tx.hash))}`, "success");
    const receipt = await tx.wait();
    addLog(`Swap ${swapCount}: ${chalk.yellow(inTokenName)} to ${chalk.yellow(outTokenName)} completed. Tx: ${chalk.blueBright(getShortHash(receipt.hash))}`, "success");
    return receipt;
  } catch (error) {
    addLog(`Swap ${swapCount}: Swap failed: ${error.message}`, "error");
    if (error.stack && isDebug) { console.error(chalk.redBright(error.stack)); }
    if (error.message.includes("nonce")) nonceTracker[wallet.address] = undefined; return null;
  }
}

async function logTransactionApi(walletAddress, txHash, amountInHuman, usdValue, currencyIn, currencyOut) {
  if (shouldStop) return;
  const payload = {
    walletAddress, chainId: 16601, txHash, amount: amountInHuman, 
    usdValue: usdValue, currencyIn, currencyOut, 
    timestamp: Date.now(), timestampFormatted: new Date().toISOString()
  };
  try {
    const response = await makeApiRequest("post", `${API_BASE_URL}/log/logTransaction`, payload);
    if (response.status === "success") { addLog(`Tx ${chalk.blueBright(getShortHash(txHash))} reported to API.`, "success"); }
    else { addLog(`Failed to report tx ${chalk.blueBright(getShortHash(txHash))} to API: ${response.message || JSON.stringify(response)}`, "error"); }
  } catch (error) { addLog(`Error reporting tx ${chalk.blueBright(getShortHash(txHash))} to API: ${error.message}`, "error"); }
}

async function fetchPointsApi(walletAddress) {
    if (shouldStop) return null; 
    try {
        addLog(`Fetching points from API...`, "info");
        const response = await makeApiRequest("get", `${API_BASE_URL}/points/${walletAddress}`);
        if (response && response.mainnetPoints !== undefined) {
            const pointsMsg = `Points - Mainnet: ${chalk.bold(response.mainnetPoints)}, Testnet: ${chalk.bold(response.testnetPoints)}, Total: ${chalk.bold(response.totalPoints)}`;
            addLog(pointsMsg, "success");
            return { 
                mainnetPoints: response.mainnetPoints,
                testnetPoints: response.testnetPoints,
                totalPoints: response.totalPoints
            };
        } else { 
            addLog(`Invalid points API response. ${JSON.stringify(response)}`, "warn"); 
            return null; 
        }
    } catch (error) { 
        addLog(`Failed to fetch points from API: ${error.message}`, "error"); 
        return null; 
    }
}

// --- Main Activity Logic ---
async function runDailyActivityForWallet(privateKey) {
  addLog(chalk.bgCyan.black.bold(" Starting daily activity cycle "), "info");
  addLog(`Auto Swap: ${chalk.yellow(SWAP_REPETITIONS + "x total attempts")}. Initial USDT->LOP: ${chalk.yellow(INITIAL_USDT_TO_LOP_SWAPS + "x")}`, "info");
  let overallActivitySuccess = true; 
  let finalBalances = { aogiBalance: "0.00", usdtBalance: "0.00", lopBalance: "0.00" };
  let totalSuccessfulSwaps = 0; 
  let fetchedPoints = { mainnetPoints: 'N/A', testnetPoints: 'N/A', totalPoints: 'N/A' }; 

  let provider;
  try {
    provider = getProvider();
    const network = await provider.getNetwork();
    addLog(`Connected to network: ${chalk.green(network.name)} (Chain ID: ${chalk.green(network.chainId)})`, "info");
  } catch (error) {
    addLog(`Failed to init/connect provider: ${error.message}. Exiting cycle.`, "error");
    await sendTelegramMessage(`🚨 *Gagal Terkoneksi ke Jaringan!* (${new Date().toLocaleString('id-ID')}):\n${error.message}`, 'HTML');
    return false;
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  addLog(`Wallet Address: ${chalk.cyanBright(wallet.address)}`, "info");
  
  await fetchAccountBalances(provider, wallet.address);

  addLog(chalk.magenta("--- Faucet Check ---"), "info");
  const cooldownStatus = await checkFaucetCooldown(wallet, provider);
  if (cooldownStatus.canClaim) {
    const claimed = await claimFaucet(wallet, provider);
    if (claimed) {
      addLog(`Waiting 5s after faucet claim...`, "wait");
      await sleep(5000);
    }
  } else { 
    const faucetMsg = `Faucet on cooldown. ${chalk.yellow(cooldownStatus.remaining)} remaining.`;
    addLog(faucetMsg, "wait"); 
  }

  addLog(chalk.magenta(`--- Starting ${SWAP_REPETITIONS} Swaps ---`), "info");
  
  let successfulSwapsCount = 0;
  for (let attempt = 1; attempt <= SWAP_REPETITIONS; attempt++) {
    if (shouldStop) { 
      addLog(`Swap attempts interrupted by user.`, "info"); 
      break; 
    }
    addLog(chalk.bgBlue.white.bold(` Swap Attempt ${attempt}/${SWAP_REPETITIONS} `), "info");
    
    let swapDetails; let chosenDirection = "";
    if (attempt <= INITIAL_USDT_TO_LOP_SWAPS) {
      addLog(`Attempt ${attempt}: Scheduled USDT -> LOP swap.`, "info");
      swapDetails = getSwapDetailsUsdtToLop();
      chosenDirection = "USDT -> LOP";
    } else {
      addLog(`Attempt ${attempt}: Considering LOP -> USDT swap.`, "info");
      const currentBalances = await fetchAccountBalances(provider, wallet.address); 
      const lopBalance = parseFloat(currentBalances.lopBalance);
      if (lopBalance >= MIN_LOP_FOR_LOP_TO_USDT_SWAP) {
        addLog(`LOP balance (${chalk.yellow(lopBalance.toFixed(4))}) sufficient for LOP->USDT (threshold: ${MIN_LOP_FOR_LOP_TO_USDT_SWAP}).`, "info");
        swapDetails = getSwapDetailsLopToUsdt(lopBalance);
        if (swapDetails) { chosenDirection = "LOP -> USDT"; }
        else {
          addLog(`Could not prepare LOP->USDT details. Defaulting to USDT -> LOP.`, "info");
          swapDetails = getSwapDetailsUsdtToLop(); chosenDirection = "USDT -> LOP (fallback LOP prep failed)";
        }
      } else {
        addLog(`LOP balance (${chalk.yellow(lopBalance.toFixed(4))}) below threshold (${MIN_LOP_FOR_LOP_TO_USDT_SWAP}). Defaulting to USDT -> LOP.`, "info");
        swapDetails = getSwapDetailsUsdtToLop(); chosenDirection = "USDT -> LOP (LOP balance low)";
      }
    }

    if (!swapDetails) {
        addLog(`Swap ${attempt}: Could not determine swap details. Skipping attempt.`, "warn");
        if (attempt < SWAP_REPETITIONS && !shouldStop) {
            const errorDelay = Math.floor(Math.random() * (7000 - 3000 + 1)) + 3000;
            addLog(`Waiting ${chalk.yellow(Math.floor(errorDelay / 1000) + "s")} after failed detail generation...`, "wait");
            await sleep(errorDelay);
        }
        continue;
    }
    addLog(`Swap ${attempt}: Direction: ${chalk.bold(chosenDirection)}, Amount: ${chalk.yellow(swapDetails.amountStr + " " + swapDetails.inToken)}.`, "info");

    try {
      const swapApiData = await sendSwapPrompt(wallet.address, swapDetails.amountStr, swapDetails.inToken, swapDetails.outToken); 
      if (!swapApiData || !swapApiData.amount || !swapApiData.amountOutMin || !swapApiData.path) {
          addLog(`Swap ${attempt}: Invalid data from API. Skipping swap. Data: ${JSON.stringify(swapApiData)}`, "error");
          overallActivitySuccess = false; 
          if (attempt < SWAP_REPETITIONS && !shouldStop) {
             const errorDelay = Math.floor(Math.random() * (10000 - 5000 + 1)) + 5000;
             addLog(`Waiting ${chalk.yellow(Math.floor(errorDelay / 1000) + "s")} after API data error...`, "wait");
             await sleep(errorDelay);
          }
          continue;
      }
      const receipt = await executeSwap(wallet, provider, swapApiData, attempt, swapDetails.inToken, swapDetails.outToken, swapDetails.inTokenAddress); 
      if (receipt) {
        successfulSwapsCount++;
        await logTransactionApi(wallet.address, receipt.hash, swapApiData.amount.toString(), swapApiData.usdValue || 0, swapDetails.inToken, swapDetails.outToken);
        await fetchAccountBalances(provider, wallet.address); 
        if (successfulSwapsCount < SWAP_REPETITIONS && !shouldStop && attempt < SWAP_REPETITIONS) { 
          const randomDelay = Math.floor(Math.random() * (25000 - 10000 + 1)) + 10000;
          addLog(`Waiting ${chalk.yellow(Math.floor(randomDelay / 1000) + "s")} before next swap...`, "wait");
          await sleep(randomDelay);
        }
      } else {
          addLog(`Swap ${attempt} did not complete successfully (executeSwap returned null).`, "warn");
          overallActivitySuccess = false;
            if (attempt < SWAP_REPETITIONS && !shouldStop) {
            const errorDelay = Math.floor(Math.random() * (10000 - 5000 + 1)) + 5000;
            addLog(`Waiting ${chalk.yellow(Math.floor(errorDelay / 1000) + "s")} after failed swap execution...`, "wait");
            await sleep(errorDelay);
          }
      }
    } catch (error) {
      addLog(`Swap ${attempt}: Main swap process failed: ${error.message}`, "error");
      overallActivitySuccess = false;
      if (attempt < SWAP_REPETITIONS && !shouldStop) {
        const errorDelay = Math.floor(Math.random() * (10000 - 5000 + 1)) + 5000;
        addLog(`Waiting ${chalk.yellow(Math.floor(errorDelay / 1000) + "s")} after error...`, "wait");
        await sleep(errorDelay);
      }
    }
      if (attempt < SWAP_REPETITIONS && !shouldStop) { addLog(chalk.dim("---"), "info");}
  }
  addLog(chalk.magenta("--- Swaps Finished ---"), "info");
  addLog(`Completed ${chalk.greenBright(successfulSwapsCount)}/${SWAP_REPETITIONS} successful swaps.`, "info");

  addLog(chalk.magenta("--- Fetching Points ---"), "info");
  const pointsData = await fetchPointsApi(wallet.address);
  if (pointsData) {
      fetchedPoints = pointsData; 
  }
  
  nonceTracker = {}; 

  if (shouldStop) { addLog("Daily activity was stopped prematurely by user.", "warn"); }
  
  finalBalances = await fetchAccountBalances(provider, wallet.address);
  totalSuccessfulSwaps = successfulSwapsCount; 
  
  const finalReportMessage = `*🤖 Laporan Aktivitas Harian Selesai!* ${shouldStop ? ' (Dihentikan)' : ''}\n\n` +
                             `*🗓️ Tanggal:* ${new Date().toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })}\n` +
                             `*🔑 Wallet:* \`${getShortAddress(wallet.address)}\`\n` +
                             `*✅ Total Swap Berhasil:* ${totalSuccessfulSwaps} dari ${SWAP_REPETITIONS}\n\n` +
                             `*💰 Saldo Akhir:*\n` +
                             `  AOGI: ${parseFloat(finalBalances.aogiBalance).toFixed(4)}\n` +
                             `  USDT: ${parseFloat(finalBalances.usdtBalance).toFixed(2)}\n` +
                             `  LOP: ${parseFloat(finalBalances.lopBalance).toFixed(2)}\n\n` +
                             `*📊 Poin TradeGPT:*\n` +
                             `  Mainnet: ${fetchedPoints.mainnetPoints}\n` +
                             `  Testnet: ${fetchedPoints.testnetPoints}\n` +
                             `  Total: ${fetchedPoints.totalPoints}`;

  await sendTelegramMessage(finalReportMessage, 'HTML');

  return overallActivitySuccess && !shouldStop; 
}

// --- Main Execution ---
async function main() {
  addLog(chalk.bgGreen.black.bold(" Script Starting Up... "), "info");
  // Notifikasi awal saat script baru dimulai
  await sendTelegramMessage("✅ *Script Otonom Dimulai!*", 'HTML'); 

  process.on("unhandledRejection", async (reason, promise) => {
    const errReason = reason instanceof Error ? reason.message : reason;
    addLog(`Unhandled Rejection. Reason: ${errReason}`, "error"); 
    if (reason instanceof Error && reason.stack) { console.error(chalk.redBright(reason.stack)); }
    await sendTelegramMessage(`🚨 *Unhandled Rejection!* (${new Date().toLocaleString('id-ID')}):\n${errReason}`, 'HTML'); 
  });
  process.on("uncaughtException", async (error) => {
    addLog(`Uncaught Exception: ${error.message}`, "error");
    if (error.stack) { console.error(chalk.redBright(error.stack)); }
    await sendTelegramMessage(`🔥 *Uncaught Exception!* (${new Date().toLocaleString('id-ID')}):\n${error.message}`, 'HTML'); 
    shouldStop = true; process.exitCode = 1;
  });
  process.on('SIGINT', async () => {
    addLog(chalk.bgYellow.black.bold(' SIGINT received. Graceful shutdown initiated... '), 'warn');
    await sendTelegramMessage(`⚠️ *SIGINT Diterima!* (${new Date().toLocaleString('id-ID')}):\nMemulai proses shutdown.`, 'HTML'); 
    shouldStop = true;
    setTimeout(async () => {
        addLog('Graceful shutdown final timeout. Forcing exit.', 'error'); 
        await sendTelegramMessage(`🚨 *Forced Exit!* (${new Date().toLocaleString('id-ID')}):\nGraceful shutdown gagal, memaksa keluar.`, 'HTML'); 
        process.exit(1); 
    }, 35000); 
  });

  if (!THE_PRIVATE_KEY || !THE_PRIVATE_KEY.startsWith('0x') || THE_PRIVATE_KEY.length !== 66) {
    addLog("PRIVATE_KEY not found or invalid in .env. Please set it (e.g., PRIVATE_KEY=0x...).", "error");
    await sendTelegramMessage(`❌ *Error Konfigurasi!* (${new Date().toLocaleString('id-ID')}):\nPRIVATE_KEY tidak ditemukan atau tidak valid di .env.`, 'HTML'); 
    process.exitCode = 1;
  } else {
    try {
      const activityResultSuccess = await runDailyActivityForWallet(THE_PRIVATE_KEY);
      if (shouldStop && process.exitCode === undefined) { 
        process.exitCode = 1; 
      } else if (process.exitCode === undefined) {
        process.exitCode = activityResultSuccess ? 0 : 1;
      }
    } catch (error) {
      addLog(`Critical error in script execution: ${error.message}`, "error");
      if (error.stack) console.error(chalk.redBright(error.stack));
      await sendTelegramMessage(`🚨 *Error Fatal Script!* (${new Date().toLocaleString('id-ID')}):\n${error.message}`, 'HTML'); 
      process.exitCode = 1;
    }
  }
  
  const finalMessage = ` Script Execution Finished. Exit Code: ${process.exitCode || 0}. `;
  if ((process.exitCode || 0) === 0) {
    addLog(chalk.bgGreen.black.bold(finalMessage), "info");
    // Laporan sukses akhir sudah dikirim dari runDailyActivityForWallet, tidak perlu di sini lagi
  } else {
    addLog(chalk.bgRed.white.bold(finalMessage), "info");
    await sendTelegramMessage(`⛔ *Script Gagal Selesai!* (\`Exit Code: ${process.exitCode || 0}\`) (${new Date().toLocaleString('id-ID')})`, 'HTML'); 
  }

  if(activeProcesses > 0 && !shouldStop) { 
      addLog(`Warning: ${activeProcesses} process(es) might still be active on exit. This might indicate an issue.`, "warn");
      await sendTelegramMessage(`⚠️ *Peringatan Saat Exit!* (${new Date().toLocaleString('id-ID')}):\n${activeProcesses} proses mungkin masih aktif.`, 'HTML');
  } else if (activeProcesses > 0 && shouldStop) {
      addLog(`Note: ${activeProcesses} process(es) were active when shutdown was forced/timed out.`, "info");
  }
  
  setTimeout(() => process.exit(process.exitCode || 0), 100);
}

main();
