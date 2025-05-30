import { ethers } from "ethers";
import fs from "fs"; // Masih digunakan untuk CONFIG_FILE jika ada fitur config lain, tapi untuk swapRepetitions tidak.
import axios from "axios";
import 'dotenv/config'; // Untuk memuat variabel dari .env

// --- Konfigurasi Hardcoded ---
const SWAP_REPETITIONS = 10; // Jumlah repetisi swap per siklus
const RPC_URL = process.env.RPC_URL || "https://0g-testnet-rpc.astrostake.xyz"; // Ambil dari .env atau default
const THE_PRIVATE_KEY = process.env.PRIVATE_KEY;

// --- Alamat Kontrak & API (tidak berubah) ---
const USDT_ADDRESS = "0xe6c489B6D3eecA451D60cfda4782e9E727490477";
const LOP_ADDRESS = "0x8b1b701966cfdd5021014bc9c18402b38091b7a8";
const ROUTER_ADDRESS = "0xDCd7d05640Be92EC91ceb1c9eA18e88aFf3a6900";
const FAUCET_ADDRESS = "0xdE56D007B41a591C98dC71e896AD0a844356e584";
const API_BASE_URL = "https://trade-gpt-800267618745.herokuapp.com";

const isDebug = false; // Set true untuk logging lebih detail

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

const USER_AGENTS = [ // Hanya satu User-Agent yang akan dipakai karena tidak ada iterasi akun
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
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${type.toUpperCase()}] [Wallet] ${message}`; // Tambahkan [Wallet] karena hanya satu
  
  if (type === "error") {
    console.error(logMessage);
  } else {
    console.log(logMessage);
  }
}

async function sleep(ms) {
  if (shouldStop) {
    addLog("Sleep interrupted due to stop request.", "info");
    return;
  }
  activeProcesses++;
  try {
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, ms);
      const checkStopInterval = setInterval(() => {
        if (shouldStop) {
          clearTimeout(timeout);
          clearInterval(checkStopInterval);
          resolve();
        }
      }, 200);
      if (timeout.unref) {
          timeout.unref(); 
      }
      setTimeout(() => clearInterval(checkStopInterval), ms);
    });
  } finally {
    activeProcesses = Math.max(0, activeProcesses - 1);
  }
}

// --- Network & Blockchain Interaction ---
function getProvider() { // Tidak ada lagi proxy
    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        return provider;
    } catch (error) {
        addLog(`Failed to initialize provider: ${error.message}`, "error");
        throw new Error("Failed to initialize provider.");
    }
}

function getApiHeaders(customHeaders = {}) { // Tidak perlu accountIndex lagi
  const userAgent = USER_AGENTS[0]; // Selalu gunakan User-Agent pertama
  return {
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "User-Agent": userAgent,
    "Origin": "https://0g.app.tradegpt.finance",
    "Referer": "https://0g.app.tradegpt.finance/",
    ...customHeaders
  };
}

async function makeApiRequest(method, url, data, customHeaders = {}, maxRetries = 3, retryDelay = 2000) { // Tidak ada proxyUrl, accountIndex
  activeProcesses++;
  let lastError = null;
  try {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (shouldStop) {
        addLog(`API request to ${url} cancelled.`, "info");
        throw new Error("Process stopped");
      }
      try {
        const headers = getApiHeaders(customHeaders); // Panggil tanpa accountIndex
        const config = { method, url, data, headers, timeout: 10000 };
        if (isDebug && data) addLog(`Sending payload to ${url}: ${JSON.stringify(data, null, 2)}`, "debug");
        
        const response = await axios(config);
        if (isDebug) addLog(`Received response from ${url}: ${JSON.stringify(response.data, null, 2)}`, "debug");
        return response.data;
      } catch (error) {
        lastError = error;
        let errMsg = `Attempt ${attempt}/${maxRetries} API request to ${url} failed`;
        if (error.response) errMsg += `: HTTP ${error.response.status} - ${JSON.stringify(error.response.data || error.response.statusText)}`;
        else if (error.request) errMsg += `: No response received`;
        else errMsg += `: ${error.message}`;
        addLog(errMsg, "error");
        if (attempt < maxRetries) {
          addLog(`Retrying API in ${retryDelay/1000}s...`, "wait");
          await sleep(retryDelay);
        }
      }
    }
    throw new Error(`API request to ${url} failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown API error'}`);
  } finally {
    activeProcesses = Math.max(0, activeProcesses - 1);
  }
}

async function fetchAccountBalances(provider, walletAddress) {
    try {
        const aogiBalanceRaw = await provider.getBalance(walletAddress);
        const usdtContract = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);
        const lopContract = new ethers.Contract(LOP_ADDRESS, ERC20_ABI, provider);

        const [usdtBalanceRaw, lopBalanceRaw, usdtDecimalsRaw, lopDecimalsRaw] = await Promise.all([
            usdtContract.balanceOf(walletAddress).catch(() => ethers.toBigInt(0)),
            lopContract.balanceOf(walletAddress).catch(() => ethers.toBigInt(0)),
            usdtContract.decimals().catch(() => 18),
            lopContract.decimals().catch(() => 18)
        ]);
        
        const usdtDecimals = Number(usdtDecimalsRaw);
        const lopDecimals = Number(lopDecimalsRaw);

        const aogiBalance = ethers.formatEther(aogiBalanceRaw);
        const usdtBalance = ethers.formatUnits(usdtBalanceRaw, usdtDecimals);
        const lopBalance = ethers.formatUnits(lopBalanceRaw, lopDecimals);

        addLog(`(${getShortAddress(walletAddress)}) Balances: AOGI: ${parseFloat(aogiBalance).toFixed(4)}, USDT: ${parseFloat(usdtBalance).toFixed(2)}, LOP: ${parseFloat(lopBalance).toFixed(2)}`, "info");
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
    addLog(`Nonce for ${getShortAddress(walletAddress)}: ${nextNonce}`, "debug");
    return nextNonce;
  } catch (error) {
    addLog(`Error fetching nonce for ${getShortAddress(walletAddress)}: ${error.message}`, "error");
    try {
        const fallbackNonce = await provider.getTransactionCount(walletAddress, "latest");
        addLog(`Using fallback nonce for ${getShortAddress(walletAddress)}: ${fallbackNonce}`, "warn");
        nonceTracker[walletAddress] = fallbackNonce;
        return fallbackNonce;
    } catch (e) {
        addLog(`Error fetching fallback nonce: ${e.message}`, "error");
        throw e;
    }
  }
}

async function checkFaucetCooldown(wallet, provider) {
  try {
    const faucet = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, provider);
    const lastRequest = await faucet.lastRequest(wallet.address);
    const cooldown = BigInt(1 * 24 * 60 * 60);
    const currentTime = BigInt(Math.floor(Date.now() / 1000));
    const timeSinceLastRequest = currentTime - BigInt(lastRequest.toString());
    
    if (timeSinceLastRequest < cooldown) {
      const remainingSeconds = cooldown - timeSinceLastRequest;
      const hours = remainingSeconds / BigInt(3600);
      const minutes = (remainingSeconds % BigInt(3600)) / BigInt(60);
      return { canClaim: false, remaining: `${hours}h ${minutes}m` };
    }
    return { canClaim: true, remaining: "0h 0m" };
  } catch (error) {
    addLog(`Failed to check faucet cooldown: ${error.message}`, "error");
    return { canClaim: false, remaining: "Unknown" };
  }
}

async function claimFaucet(wallet, provider) {
  if (shouldStop) {
    addLog(`Faucet claim cancelled.`, "info");
    return false;
  }
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
        txOverrides.gasPrice = feeData.gasPrice;
        delete txOverrides.maxFeePerGas; delete txOverrides.maxPriorityFeePerGas;
    }
    const tx = await faucet.requestTokens(txOverrides);
    addLog(`Faucet claim tx sent. Hash: ${getShortHash(tx.hash)}`, "success");
    await tx.wait();
    addLog(`Successfully claimed 100 USDT from faucet.`, "success");
    return true;
  } catch (error) {
    addLog(`Failed to claim faucet: ${error.message}`, "error");
    if (error.message.includes("nonce")) nonceTracker[wallet.address] = undefined;
    return false;
  }
}

async function checkAndApproveToken(wallet, provider, tokenAddress, amountInWei, tokenName, swapCount) {
  if (shouldStop) {
    addLog(`Approval for ${tokenName} cancelled.`, "info");
    return false;
  }
  const signer = wallet.connect(provider);
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  addLog(`Swap ${swapCount}: Checking balance & allowance for ${tokenName}...`, "debug");
  try {
    const balance = await token.balanceOf(signer.address);
    const tokenDecimals = await token.decimals().catch(() => 18);
    if (balance < amountInWei) {
      addLog(`Swap ${swapCount}: Insufficient ${tokenName} balance (${ethers.formatUnits(balance, Number(tokenDecimals))}). Needed: ${ethers.formatUnits(amountInWei, Number(tokenDecimals))}`, "error");
      return false;
    }
    const allowance = await token.allowance(signer.address, ROUTER_ADDRESS);
    if (allowance < amountInWei) {
      addLog(`Swap ${swapCount}: Approving ${tokenName} for router. Allowance: ${ethers.formatUnits(allowance,Number(tokenDecimals))}, Need: ${ethers.formatUnits(amountInWei,Number(tokenDecimals))}`, "info");
      const nonce = await getNextNonce(provider, signer.address);
      const feeData = await provider.getFeeData();
      const txOverrides = {
        gasLimit: 100000n, nonce: nonce,
        maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1.5", "gwei"),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei")
      };
      if(!txOverrides.maxFeePerGas && !txOverrides.maxPriorityFeePerGas && feeData.gasPrice) {
        txOverrides.gasPrice = feeData.gasPrice;
        delete txOverrides.maxFeePerGas; delete txOverrides.maxPriorityFeePerGas;
      }
      const tx = await token.approve(ROUTER_ADDRESS, ethers.MaxUint256, txOverrides);
      addLog(`Swap ${swapCount}: Approval for ${tokenName} sent. Hash: ${getShortHash(tx.hash)}`, "success");
      await tx.wait();
      addLog(`Swap ${swapCount}: ${tokenName} approved.`, "success");
    } else {
      addLog(`Swap ${swapCount}: Sufficient ${tokenName} allowance present.`, "debug");
    }
    return true;
  } catch (error) {
    addLog(`Swap ${swapCount}: Error approving/checking ${tokenName}: ${error.message}`, "error");
    if (error.message.includes("nonce")) nonceTracker[wallet.address] = undefined;
    return false;
  }
}

function getSwapDetailsUsdtToLop() {
  const minUsdt = 5; const maxUsdt = 10;
  const amount = (Math.random() * (maxUsdt - minUsdt) + minUsdt).toFixed(2);
  addLog(`Preparing USDT -> LOP swap for ${amount} USDT.`, "debug");
  return { 
    amountStr: amount.toString(), inToken: "USDT", outToken: "LOP", 
    inTokenAddress: USDT_ADDRESS, outTokenAddress: LOP_ADDRESS
  };
}

async function sendSwapPrompt(walletAddress, amountStr, inToken, outToken) {
  const prompt = `Swap ${amountStr} ${inToken} to ${outToken}`;
  addLog(`Sending prompt to API: "${prompt}"`, "info");
  const payload = {
    chainId: 16601, user: walletAddress,
    questions: [{
        question: prompt, answer: "",
        baseMessage: { lc: 1, type: "constructor", id: ["langchain_core", "messages", "HumanMessage"], kwargs: { content: prompt, additional_kwargs: {}, response_metadata: {}}},
        type: null, priceHistorical: null, priceHistoricalData: null, isSynchronized: false, isFallback: false
    }],
    testnetOnly: true
  };
  try {
    const response = await makeApiRequest("post", `${API_BASE_URL}/ask/ask`, payload);
    if (response.questions && response.questions[0].answer) {
      const traderContent = response.questions[0].answer.find(a => a.type === "trader")?.content;
      if (traderContent) {
        addLog(`Received swap data from API.`, "debug");
        return JSON.parse(traderContent);
      }
    }
    addLog(`Invalid API response for swap prompt. Resp: ${JSON.stringify(response)}`, "error");
    throw new Error("Invalid response from AI API for swap prompt");
  } catch (error) {
    addLog(`Failed to send/parse swap prompt: ${error.message}`, "error");
    throw error;
  }
}

// ... (bagian atas fungsi executeSwap tetap sama) ...

async function executeSwap(wallet, provider, swapApiData, swapCount, inTokenName, outTokenName, inTokenAddress) {
  if (shouldStop) {
    addLog(`Swap ${swapCount} cancelled.`, "info");
    return null;
  }
  const signer = wallet.connect(provider);
  const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);
  addLog(`Swap ${swapCount}: Preparing to swap ${swapApiData.amount} ${inTokenName} for ${outTokenName}.`, "info");
  try {
    const inTokenContract = new ethers.Contract(inTokenAddress, ERC20_ABI, provider);
    const inTokenDecimals = await inTokenContract.decimals().catch(() => 18); // Default ke 18 jika gagal ambil decimals
    const amountIn = ethers.parseUnits(swapApiData.amount.toString(), Number(inTokenDecimals));

    // ---- PERBAIKAN DI SINI ----
    // Ambil alamat token output (LOP) dari path yang diberikan API. Token terakhir di path adalah token output.
    if (!swapApiData.path || swapApiData.path.length < 2) {
        addLog(`Swap ${swapCount}: Invalid path received from API: ${swapApiData.path}`, "error");
        return null;
    }
    const outTokenAddressFromPath = swapApiData.path[swapApiData.path.length - 1];
    const outTokenContract = new ethers.Contract(outTokenAddressFromPath, ERC20_ABI, provider);
    const outTokenDecimals = await outTokenContract.decimals().catch(() => 18); // Default ke 18 jika gagal ambil decimals
    
    // Konversi amountOutMin dari string desimal ke BigInt dalam satuan wei
    const amountOutMin = ethers.parseUnits(swapApiData.amountOutMin.toString(), Number(outTokenDecimals)); 
    // ---- AKHIR PERBAIKAN ----

    const path = swapApiData.path;
    const to = signer.address;
    const deadline = Math.floor(Date.now() / 1000) + 600; // 10 menit

    const isApproved = await checkAndApproveToken(wallet, provider, inTokenAddress, amountIn, inTokenName, swapCount);
    if (!isApproved) {
      addLog(`Swap ${swapCount}: Approval failed/insufficient balance. Skipping.`, "warn");
      return null;
    }
    addLog(`Swap ${swapCount}: Executing swap on router... (AmountIn: ${ethers.formatUnits(amountIn, Number(inTokenDecimals))} ${inTokenName}, AmountOutMin: ${ethers.formatUnits(amountOutMin, Number(outTokenDecimals))} ${outTokenName})`, "info"); // Log tambahan untuk debug
    const nonce = await getNextNonce(provider, signer.address);
    const feeData = await provider.getFeeData();
    const txOverrides = {
        gasLimit: 300000n, // Anda bisa sesuaikan jika perlu
        nonce: nonce,
        maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits("1.5", "gwei"),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei")
    };
     if(!txOverrides.maxFeePerGas && !txOverrides.maxPriorityFeePerGas && feeData.gasPrice) {
        txOverrides.gasPrice = feeData.gasPrice; // Fallback ke gasPrice jika EIP-1559 tidak tersedia
        delete txOverrides.maxFeePerGas; 
        delete txOverrides.maxPriorityFeePerGas;
    }
    const tx = await router.swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline, txOverrides);
    addLog(`Swap ${swapCount}: Tx sent. Hash: ${getShortHash(tx.hash)}`, "success");
    const receipt = await tx.wait();
    addLog(`Swap ${swapCount}: ${inTokenName} to ${outTokenName} completed. Tx: ${getShortHash(receipt.hash)}`, "success");
    return receipt;
  } catch (error) {
    addLog(`Swap ${swapCount}: Swap failed: ${error.message}`, "error");
    if (error.stack && isDebug) { // Tampilkan stack trace jika isDebug true
        console.error(error.stack);
    }
    if (error.message.includes("nonce")) nonceTracker[wallet.address] = undefined;
    return null;
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
    if (response.status === "success") {
      addLog(`Tx ${getShortHash(txHash)} reported to API.`, "success");
    } else {
      addLog(`Failed to report tx ${getShortHash(txHash)} to API: ${response.message || JSON.stringify(response)}`, "error");
    }
  } catch (error) {
    addLog(`Error reporting tx ${getShortHash(txHash)} to API: ${error.message}`, "error");
  }
}

async function fetchPointsApi(walletAddress) {
    if (shouldStop) return;
    try {
        addLog(`Fetching points from API...`, "info");
        const response = await makeApiRequest("get", `${API_BASE_URL}/points/${walletAddress}`);
        if (response && response.mainnetPoints !== undefined) {
            addLog(`Points - Mainnet: ${response.mainnetPoints}, Testnet: ${response.testnetPoints}, Total: ${response.totalPoints}`, "success");
        } else {
            addLog(`Invalid points API response. ${JSON.stringify(response)}`, "warn");
        }
    } catch (error) {
        addLog(`Failed to fetch points from API: ${error.message}`, "error");
    }
}

// --- Main Activity Logic ---
async function runDailyActivityForWallet(privateKey) {
  addLog(`Starting daily activity. Auto Swap (USDT->LOP): ${SWAP_REPETITIONS}x.`, "info");
  let overallSuccess = true;

  let provider;
  try {
    provider = getProvider();
    const network = await provider.getNetwork();
    addLog(`Connected to network: ${network.name} (Chain ID: ${network.chainId})`, "info");
  } catch (error) {
    addLog(`Failed to init/connect provider: ${error.message}. Exiting.`, "error");
    return false; // Indicate failure
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  addLog(`Wallet Address: ${wallet.address}`, "info");
  await fetchAccountBalances(provider, wallet.address);

  // 1. Faucet Claim
  const cooldownStatus = await checkFaucetCooldown(wallet, provider);
  if (cooldownStatus.canClaim) {
    const claimed = await claimFaucet(wallet, provider);
    if (claimed) {
      addLog(`Waiting 5s after faucet claim...`, "wait");
      await sleep(5000);
      await fetchAccountBalances(provider, wallet.address);
    }
  } else {
    addLog(`Faucet on cooldown. ${cooldownStatus.remaining} remaining.`, "wait");
  }

  // 2. Swaps (USDT -> LOP)
  let successfulSwaps = 0;
  for (let attempt = 1; attempt <= SWAP_REPETITIONS; attempt++) {
    if (shouldStop) {
      addLog(`Swap attempts interrupted.`, "info");
      break;
    }
    addLog(`Starting Swap Attempt ${attempt}/${SWAP_REPETITIONS}...`, "info");
    const swapDetails = getSwapDetailsUsdtToLop();
    try {
      const swapApiData = await sendSwapPrompt(wallet.address, swapDetails.amountStr, swapDetails.inToken, swapDetails.outToken);
      if (!swapApiData || !swapApiData.amount || !swapApiData.amountOutMin || !swapApiData.path) {
          addLog(`Swap ${attempt}: Invalid data from API. Skipping. Data: ${JSON.stringify(swapApiData)}`, "error");
          continue;
      }
      const receipt = await executeSwap(wallet, provider, swapApiData, attempt, swapDetails.inToken, swapDetails.outToken, swapDetails.inTokenAddress);
      if (receipt) {
        successfulSwaps++;
        await logTransactionApi(wallet.address, receipt.hash, swapApiData.amount.toString(), swapApiData.usdValue || 0, swapDetails.inToken, swapDetails.outToken);
        await fetchAccountBalances(provider, wallet.address);
        if (successfulSwaps < SWAP_REPETITIONS && !shouldStop) {
          const randomDelay = Math.floor(Math.random() * (30000 - 15000 + 1)) + 15000;
          addLog(`Waiting ${Math.floor(randomDelay / 1000)}s before next swap...`, "wait");
          await sleep(randomDelay);
        }
      } else {
          addLog(`Swap ${attempt} did not complete successfully.`, "warn");
      }
    } catch (error) {
      addLog(`Swap ${attempt}: Main swap process failed: ${error.message}`, "error");
      await sleep(5000);
    }
  }
  addLog(`Completed ${successfulSwaps}/${SWAP_REPETITIONS} successful USDT->LOP swaps.`, "info");

  // 3. Fetch Points from API
  await fetchPointsApi(wallet.address);
  
  nonceTracker = {}; // Reset nonce for the wallet at the end of its run.

  if (shouldStop) {
    addLog("Daily activity was stopped prematurely.", "warn");
    const stopCheckStart = Date.now();
    while(activeProcesses > 0 && (Date.now() - stopCheckStart < 30000)) {
        addLog(`Waiting for ${activeProcesses} active process(es) to complete...`, "info");
        await sleep(1000);
    }
    if(activeProcesses > 0) addLog(`Warning: ${activeProcesses} process(es) still active after stop timeout.`, "warn");
  }
  return overallSuccess && !shouldStop;
}

// --- Main Execution ---
async function main() {
  addLog("Script starting up...", "info");
  process.on("unhandledRejection", (reason, promise) => {
    const errReason = reason instanceof Error ? reason.message : reason;
    addLog(`Unhandled Rejection at: ${promise}, reason: ${errReason}`, "error");
    if (reason instanceof Error && reason.stack) console.error(reason.stack);
  });
  process.on("uncaughtException", (error) => {
    addLog(`Uncaught Exception: ${error.message}`, "error");
    console.error(error.stack);
    shouldStop = true; process.exitCode = 1;
  });
  process.on('SIGINT', () => {
    addLog('SIGINT received. Graceful shutdown initiated...', 'warn');
    shouldStop = true;
    setTimeout(() => { addLog('Graceful shutdown timeout. Forcing exit.', 'error'); process.exit(1); }, 30000);
  });

  if (!THE_PRIVATE_KEY || !THE_PRIVATE_KEY.startsWith('0x') || THE_PRIVATE_KEY.length !== 66) { // Basic PK check
    addLog("PRIVATE_KEY not found or invalid in environment variables (.env). Please set it correctly (e.g., PRIVATE_KEY=0x...).", "error");
    process.exitCode = 1;
  } else {
    try {
      const success = await runDailyActivityForWallet(THE_PRIVATE_KEY);
      process.exitCode = success ? 0 : 1;
    } catch (error) {
      addLog(`Critical error in script execution: ${error.message}`, "error");
      if (error.stack) console.error(error.stack);
      process.exitCode = 1;
    }
  }
  
  addLog(`Script execution finished. Exit code: ${process.exitCode || 0}.`, "info");
  if(activeProcesses > 0) addLog(`Warning: ${activeProcesses} process(es) might still be active on exit.`, "warn");
  process.exit(process.exitCode || 0);
}

main();
