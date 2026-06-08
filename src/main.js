import { ethers } from "https://cdnjs.cloudflare.com/ajax/libs/ethers/6.11.1/ethers.js";

// Configured contract addresses (populated after deployment)
// Defaults to standard Hardhat local network address defaults
const CONTRACTS = {
  MST: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  StakingPool: "0x9fE46736679d249a606B237675964e1F15740809",
  RewardDistributor: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
};

// Human-readable ABIs for Ethers.js
const ABIs = {
  MST: [
    "function balanceOf(address owner) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 value) returns (bool)",
    "function transfer(address to, uint256 value) returns (bool)",
    "function mint(address to, uint256 amount) external"
  ],
  StakingPool: [
    "function stakers(address user) view returns (uint256 stakedAmount, uint256 lockedUntil)",
    "function stake(uint256 amount) external",
    "function unstake(uint256 amount) external",
    "function emergencyWithdraw() external"
  ],
  RewardDistributor: [
    "function calculateReward(address user) view returns (uint256)",
    "function claimReward() external"
  ]
};

// Application State
let isWeb3Mode = false;
let provider, signer, userAddress;
let contracts = { mst: null, pool: null, distributor: null };

// Sandbox state (for simulation mode)
const sandboxState = {
  walletBalance: 5000.0, // starts with 5000 MST
  stakedBalance: 0.0,
  lockedUntil: 0,        // timestamp (seconds)
  accumulatedRewards: 0.0,
  lastUpdateTime: 0,
  simulatedTimeOffset: 0, // offset in seconds from Date.now()
  tvl: 152500.0,         // simulated TVL
  apr: 0.12,             // 12% APR
};

// Get current simulated block time
function getSimulatedTime() {
  return Math.floor(Date.now() / 1000) + sandboxState.simulatedTimeOffset;
}

// UI Elements
const dom = {
  modeSandboxBtn: document.getElementById("mode-sandbox-btn"),
  modeWeb3Btn: document.getElementById("mode-web3-btn"),
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  connectWalletBtn: document.getElementById("connect-wallet-btn"),
  
  statTVL: document.getElementById("stat-tvl"),
  statAPY: document.getElementById("stat-apy"),
  statStaked: document.getElementById("stat-staked"),
  statBalance: document.getElementById("stat-balance"),
  
  tabStake: document.getElementById("tab-stake"),
  tabUnstake: document.getElementById("tab-unstake"),
  stakeContent: document.getElementById("stake-content"),
  unstakeContent: document.getElementById("unstake-content"),
  
  stakeAmount: document.getElementById("stake-amount"),
  btnStakeMax: document.getElementById("btn-stake-max"),
  btnApprove: document.getElementById("btn-approve"),
  btnStake: document.getElementById("btn-stake"),
  
  unstakeAmount: document.getElementById("unstake-amount"),
  btnUnstakeMax: document.getElementById("btn-unstake-max"),
  btnUnstake: document.getElementById("btn-unstake"),
  lockTimer: document.getElementById("lock-timer"),
  
  rewardsAmount: document.getElementById("rewards-amount"),
  btnClaim: document.getElementById("btn-claim"),
  
  btnEmergency: document.getElementById("btn-emergency-withdraw"),
  
  sandboxPanel: document.getElementById("sandbox-panel"),
  btnFaucet: document.getElementById("btn-faucet"),
  btnTime1h: document.getElementById("btn-time-1h"),
  btnTime1d: document.getElementById("btn-time-1d"),
  btnTime7d: document.getElementById("btn-time-7d"),
  consoleLogs: document.getElementById("console-logs")
};

// Log helper for sandbox console
function logToConsole(message, type = "info") {
  const entry = document.createElement("div");
  entry.className = `log-entry log-${type}`;
  entry.textContent = `> [${new Date().toLocaleTimeString()}] ${message}`;
  dom.consoleLogs.appendChild(entry);
  dom.consoleLogs.scrollTop = dom.consoleLogs.scrollHeight;
}

// Tab Switching
dom.tabStake.addEventListener("click", () => {
  dom.tabStake.classList.add("active");
  dom.tabUnstake.classList.remove("active");
  dom.stakeContent.classList.add("active");
  dom.unstakeContent.classList.remove("active");
});

dom.tabUnstake.addEventListener("click", () => {
  dom.tabUnstake.classList.add("active");
  dom.tabStake.classList.remove("active");
  dom.unstakeContent.classList.add("active");
  dom.stakeContent.classList.remove("active");
});

// Mode Tab Switching
dom.modeSandboxBtn.addEventListener("click", () => {
  if (isWeb3Mode) {
    dom.modeSandboxBtn.classList.add("active");
    dom.modeWeb3Btn.classList.remove("active");
    initSandbox();
  }
});

dom.modeWeb3Btn.addEventListener("click", async () => {
  if (!isWeb3Mode) {
    dom.modeWeb3Btn.classList.add("active");
    dom.modeSandboxBtn.classList.remove("active");
    await initWeb3();
  }
});

// INITIALIZE SANDBOX MODE
function initSandbox() {
  isWeb3Mode = false;
  dom.modeSandboxBtn.classList.add("active");
  dom.modeWeb3Btn.classList.remove("active");
  dom.statusText.textContent = "Sandbox Mode";
  dom.statusDot.className = "dot dot-sandbox";
  dom.connectWalletBtn.style.display = "none";
  dom.sandboxPanel.style.display = "flex";
  
  // Set initial update time
  sandboxState.lastUpdateTime = getSimulatedTime();
  
  logToConsole("Switched to Sandbox Simulation Mode.", "info");
  logToConsole("Virtual wallet loaded with 5,000.00 MST.", "success");
  
  updateUI();
}

// Sandbox calculation logic
function getSandboxAccruedRewards() {
  const currentStaked = sandboxState.stakedBalance;
  if (currentStaked === 0) return sandboxState.accumulatedRewards;
  
  const timeDiff = getSimulatedTime() - sandboxState.lastUpdateTime;
  const yearInSeconds = 365 * 24 * 60 * 60;
  const pending = (currentStaked * sandboxState.apr * timeDiff) / yearInSeconds;
  return sandboxState.accumulatedRewards + pending;
}

// Tick loop for real-time sandbox reward ticking
function startSandboxTicker() {
  setInterval(() => {
    if (!isWeb3Mode) {
      const totalRewards = getSandboxAccruedRewards();
      dom.rewardsAmount.textContent = totalRewards.toFixed(6);
      
      // Update lock countdown in UI
      updateLockTimerUI();
    }
  }, 100);
}

function updateLockTimerUI() {
  const now = getSimulatedTime();
  if (isWeb3Mode) return; // Web3 timer handled separately or on refresh

  if (sandboxState.stakedBalance === 0) {
    dom.lockTimer.textContent = "No active stake";
    dom.lockTimer.className = "lock-value text-muted";
  } else if (now >= sandboxState.lockedUntil) {
    dom.lockTimer.textContent = "Unlocked (Ready to unstake)";
    dom.lockTimer.className = "lock-value text-emerald";
  } else {
    const remaining = sandboxState.lockedUntil - now;
    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = remaining % 60;
    
    dom.lockTimer.textContent = `Locked for: ${days}d ${hours}h ${minutes}m ${seconds}s`;
    dom.lockTimer.className = "lock-value text-warning";
  }
}

// Update UI stats from state
function updateUI() {
  if (isWeb3Mode) return; // Web3 has its own refresh updates
  
  dom.statTVL.textContent = `${sandboxState.tvl.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} MST`;
  dom.statStaked.textContent = `${sandboxState.stakedBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} MST`;
  dom.statBalance.textContent = `${sandboxState.walletBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} MST`;
  
  // Sandbox buttons activation
  dom.btnApprove.style.display = "none"; // no approvals needed in sandbox
  dom.btnStake.removeAttribute("disabled");
  dom.btnStake.style.gridColumn = "span 2";
}

// SANDBOX ACTION HANDLERS
dom.btnStakeMax.addEventListener("click", () => {
  if (isWeb3Mode) {
    // Web3 handled in another handler
  } else {
    dom.stakeAmount.value = sandboxState.walletBalance;
  }
});

dom.btnUnstakeMax.addEventListener("click", () => {
  if (isWeb3Mode) {
    // Web3 handled in another handler
  } else {
    dom.unstakeAmount.value = sandboxState.stakedBalance;
  }
});

// Sandbox Stake execution
dom.btnStake.addEventListener("click", () => {
  if (isWeb3Mode) return;
  
  const amount = parseFloat(dom.stakeAmount.value);
  if (isNaN(amount) || amount <= 0) {
    logToConsole("Invalid staking amount.", "error");
    return;
  }
  
  if (amount > sandboxState.walletBalance) {
    logToConsole("Insufficient MST balance in wallet.", "error");
    return;
  }
  
  // Checkpoint rewards first
  const accrued = getSandboxAccruedRewards();
  sandboxState.accumulatedRewards = accrued;
  sandboxState.lastUpdateTime = getSimulatedTime();
  
  // Update balances
  sandboxState.walletBalance -= amount;
  sandboxState.stakedBalance += amount;
  sandboxState.tvl += amount;
  
  // Set 7 days lock (7 * 86400)
  sandboxState.lockedUntil = getSimulatedTime() + (7 * 24 * 60 * 60);
  
  logToConsole(`Successfully staked ${amount.toFixed(2)} MST. Lock-up ends in 7 days.`, "success");
  dom.stakeAmount.value = "";
  updateUI();
});

// Sandbox Unstake execution
dom.btnUnstake.addEventListener("click", () => {
  if (isWeb3Mode) return;
  
  const amount = parseFloat(dom.unstakeAmount.value);
  if (isNaN(amount) || amount <= 0) {
    logToConsole("Invalid unstaking amount.", "error");
    return;
  }
  
  if (amount > sandboxState.stakedBalance) {
    logToConsole("Insufficient staked balance.", "error");
    return;
  }
  
  const now = getSimulatedTime();
  if (now < sandboxState.lockedUntil) {
    const remaining = sandboxState.lockedUntil - now;
    logToConsole(`Tokens are locked. Unstake available in ${Math.ceil(remaining / 60)} minutes.`, "error");
    return;
  }
  
  // Checkpoint rewards first
  const accrued = getSandboxAccruedRewards();
  sandboxState.accumulatedRewards = accrued;
  sandboxState.lastUpdateTime = now;
  
  // Update balances
  sandboxState.stakedBalance -= amount;
  sandboxState.walletBalance += amount;
  sandboxState.tvl -= amount;
  
  logToConsole(`Successfully unstaked ${amount.toFixed(2)} MST.`, "success");
  dom.unstakeAmount.value = "";
  updateUI();
});

// Sandbox Claim execution
dom.btnClaim.addEventListener("click", () => {
  if (isWeb3Mode) return;
  
  const accrued = getSandboxAccruedRewards();
  if (accrued === 0) {
    logToConsole("No rewards to claim.", "warning");
    return;
  }
  
  sandboxState.walletBalance += accrued;
  sandboxState.accumulatedRewards = 0;
  sandboxState.lastUpdateTime = getSimulatedTime();
  
  logToConsole(`Claimed ${accrued.toFixed(6)} MST rewards.`, "success");
  updateUI();
});

// Sandbox Emergency Withdraw execution
dom.btnEmergency.addEventListener("click", () => {
  if (isWeb3Mode) return;
  
  if (sandboxState.stakedBalance === 0) {
    logToConsole("Nothing staked to withdraw.", "error");
    return;
  }
  
  const withdrawAmount = sandboxState.stakedBalance;
  
  // Forfeits rewards, updates state
  sandboxState.walletBalance += withdrawAmount;
  sandboxState.stakedBalance = 0;
  sandboxState.accumulatedRewards = 0;
  sandboxState.lastUpdateTime = getSimulatedTime();
  sandboxState.tvl -= withdrawAmount;
  
  logToConsole(`Emergency Exit Triggered! Withdrew ${withdrawAmount.toFixed(2)} MST. Accrued rewards forfeited.`, "warning");
  updateUI();
});

// Sandbox Faucet
dom.btnFaucet.addEventListener("click", () => {
  if (isWeb3Mode) return;
  sandboxState.walletBalance += 1000.0;
  logToConsole("Received 1,000.00 faucet MST tokens.", "success");
  updateUI();
});

// Sandbox Time Travel
dom.btnTime1h.addEventListener("click", () => {
  if (isWeb3Mode) return;
  sandboxState.simulatedTimeOffset += 3600; // 1 hour
  logToConsole("Time advanced by +1 Hour.", "info");
});

dom.btnTime1d.addEventListener("click", () => {
  if (isWeb3Mode) return;
  sandboxState.simulatedTimeOffset += 86400; // 1 day
  logToConsole("Time advanced by +1 Day.", "info");
});

dom.btnTime7d.addEventListener("click", () => {
  if (isWeb3Mode) return;
  sandboxState.simulatedTimeOffset += 7 * 86400; // 7 days
  logToConsole("Time advanced by +7 Days.", "info");
});


// WEB3 NODE INTEGRATION
async function initWeb3() {
  dom.sandboxPanel.style.display = "none";
  dom.connectWalletBtn.style.display = "block";
  dom.statusText.textContent = "Disconnected";
  dom.statusDot.className = "dot dot-disconnected";
  
  if (!window.ethereum) {
    alert("MetaMask or Web3 wallet not detected. Reverting to Sandbox Mode.");
    initSandbox();
    return;
  }
  
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    // Bind connect wallet action
    dom.connectWalletBtn.addEventListener("click", connectWallet);
    
    // Auto-connect if already authorized
    const accounts = await provider.listAccounts();
    if (accounts.length > 0) {
      await connectWallet();
    }
  } catch (err) {
    console.error("Web3 initialization failed", err);
    initSandbox();
  }
}

async function connectWallet() {
  try {
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();
    
    dom.statusText.textContent = "Connected";
    dom.statusDot.className = "dot dot-connected";
    dom.connectWalletBtn.textContent = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
    
    // Instantiate contract wrappers
    contracts.mst = new ethers.Contract(CONTRACTS.MST, ABIs.MST, signer);
    contracts.pool = new ethers.Contract(CONTRACTS.StakingPool, ABIs.StakingPool, signer);
    contracts.distributor = new ethers.Contract(CONTRACTS.RewardDistributor, ABIs.RewardDistributor, signer);
    
    await refreshWeb3State();
    
    // Set up continuous refresh for rewards
    setInterval(async () => {
      if (isWeb3Mode && userAddress) {
        await refreshWeb3Rewards();
      }
    }, 2000);
    
  } catch (err) {
    console.error("Connection failed", err);
    alert("Failed to connect wallet. Check if local Hardhat node is running and MetaMask is configured for localhost.");
  }
}

async function refreshWeb3State() {
  if (!userAddress) return;
  
  try {
    // Fetch wallet balance
    const balance = await contracts.mst.balanceOf(userAddress);
    dom.statBalance.textContent = `${parseFloat(ethers.formatUnits(balance, 18)).toFixed(2)} MST`;
    
    // Fetch staker record
    const staker = await contracts.pool.stakers(userAddress);
    const stakedAmount = staker.stakedAmount;
    const lockedUntil = Number(staker.lockedUntil);
    
    dom.statStaked.textContent = `${parseFloat(ethers.formatUnits(stakedAmount, 18)).toFixed(2)} MST`;
    
    // Fetch pool contract MST balance for TVL
    const tvl = await contracts.mst.balanceOf(CONTRACTS.StakingPool);
    dom.statTVL.textContent = `${parseFloat(ethers.formatUnits(tvl, 18)).toFixed(2)} MST`;
    
    // Handle lock timer display
    const currentBlockTime = Math.floor(Date.now() / 1000);
    if (stakedAmount === 0n) {
      dom.lockTimer.textContent = "No active stake";
      dom.lockTimer.className = "lock-value text-muted";
    } else if (currentBlockTime >= lockedUntil) {
      dom.lockTimer.textContent = "Unlocked (Ready to unstake)";
      dom.lockTimer.className = "lock-value text-emerald";
    } else {
      const date = new Date(lockedUntil * 1000);
      dom.lockTimer.textContent = `Locked until: ${date.toLocaleString()}`;
      dom.lockTimer.className = "lock-value text-warning";
    }
    
    // Handle approvals state UI
    const allowance = await contracts.mst.allowance(userAddress, CONTRACTS.StakingPool);
    if (allowance > 0n) {
      dom.btnApprove.style.display = "none";
      dom.btnStake.removeAttribute("disabled");
      dom.btnStake.style.gridColumn = "span 2";
    } else {
      dom.btnApprove.style.display = "block";
      dom.btnStake.setAttribute("disabled", "true");
      dom.btnStake.style.gridColumn = "auto";
    }
    
    await refreshWeb3Rewards();
  } catch (err) {
    console.error("Failed to refresh Web3 state", err);
  }
}

async function refreshWeb3Rewards() {
  try {
    const reward = await contracts.distributor.calculateReward(userAddress);
    dom.rewardsAmount.textContent = parseFloat(ethers.formatUnits(reward, 18)).toFixed(6);
  } catch (err) {
    console.error("Failed to fetch rewards", err);
  }
}

// WEB3 HANDLERS
// Approve MST
dom.btnApprove.addEventListener("click", async () => {
  if (!isWeb3Mode || !contracts.mst) return;
  try {
    dom.btnApprove.textContent = "Approving...";
    dom.btnApprove.setAttribute("disabled", "true");
    
    const maxUint256 = ethers.MaxUint256;
    const tx = await contracts.mst.approve(CONTRACTS.StakingPool, maxUint256);
    await tx.wait();
    
    await refreshWeb3State();
    dom.btnApprove.textContent = "Approve MST";
  } catch (err) {
    console.error("Approval failed", err);
    dom.btnApprove.textContent = "Approve MST";
    dom.btnApprove.removeAttribute("disabled");
  }
});

// Stake MST
dom.btnStake.addEventListener("click", async () => {
  if (!isWeb3Mode || !contracts.pool) return;
  const amountStr = dom.stakeAmount.value;
  if (!amountStr || parseFloat(amountStr) <= 0) return;
  
  try {
    dom.btnStake.textContent = "Staking...";
    dom.btnStake.setAttribute("disabled", "true");
    
    const amount = ethers.parseUnits(amountStr, 18);
    const tx = await contracts.pool.stake(amount);
    await tx.wait();
    
    dom.stakeAmount.value = "";
    await refreshWeb3State();
  } catch (err) {
    console.error("Stake failed", err);
  } finally {
    dom.btnStake.textContent = "Stake MST";
    dom.btnStake.removeAttribute("disabled");
  }
});

// Unstake MST
dom.btnUnstake.addEventListener("click", async () => {
  if (!isWeb3Mode || !contracts.pool) return;
  const amountStr = dom.unstakeAmount.value;
  if (!amountStr || parseFloat(amountStr) <= 0) return;
  
  try {
    dom.btnUnstake.textContent = "Unstaking...";
    dom.btnUnstake.setAttribute("disabled", "true");
    
    const amount = ethers.parseUnits(amountStr, 18);
    const tx = await contracts.pool.unstake(amount);
    await tx.wait();
    
    dom.unstakeAmount.value = "";
    await refreshWeb3State();
  } catch (err) {
    console.error("Unstake failed", err);
    alert("Unstake failed. Make sure lock period has expired and you have enough staked balance.");
  } finally {
    dom.btnUnstake.textContent = "Unstake MST";
    dom.btnUnstake.removeAttribute("disabled");
  }
});

// Claim Rewards
dom.btnClaim.addEventListener("click", async () => {
  if (!isWeb3Mode || !contracts.distributor) return;
  try {
    dom.btnClaim.textContent = "Claiming...";
    dom.btnClaim.setAttribute("disabled", "true");
    
    const tx = await contracts.distributor.claimReward();
    await tx.wait();
    
    await refreshWeb3State();
  } catch (err) {
    console.error("Claim failed", err);
  } finally {
    dom.btnClaim.textContent = "Claim Staking Rewards";
    dom.btnClaim.removeAttribute("disabled");
  }
});

// Emergency Withdraw
dom.btnEmergency.addEventListener("click", async () => {
  if (!isWeb3Mode || !contracts.pool) return;
  if (!confirm("Are you sure? This will withdraw all your staked tokens and FORFEIT ALL ACCRUED REWARDS!")) return;
  
  try {
    dom.btnEmergency.textContent = "Withdrawing...";
    dom.btnEmergency.setAttribute("disabled", "true");
    
    const tx = await contracts.pool.emergencyWithdraw();
    await tx.wait();
    
    await refreshWeb3State();
  } catch (err) {
    console.error("Emergency withdraw failed", err);
  } finally {
    dom.btnEmergency.textContent = "Emergency Withdraw";
    dom.btnEmergency.removeAttribute("disabled");
  }
});


// Start applications
initSandbox();
startSandboxTicker();
