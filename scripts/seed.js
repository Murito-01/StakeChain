import pkg from "hardhat";
const { ethers } = pkg;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Seeding contracts with deployer:", deployer.address);

  // We assume contracts are already deployed. Let's get the contract instances.
  // In a real environment, we would look up their deployed addresses.
  // For this script, we will deploy them fresh or we can attach to existing addresses if provided.
  // To make the seeding script self-contained and run on a fresh local node, let's deploy them first,
  // then seed them, and print their addresses so the user can copy them into the web app config!
  
  // 1. Deploy MST
  const MiniStakeToken = await ethers.getContractFactory("MiniStakeToken");
  const token = await MiniStakeToken.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("MiniStakeToken deployed to:", tokenAddress);

  // 2. Deploy RewardDistributor
  const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
  const distributor = await RewardDistributor.deploy(tokenAddress);
  await distributor.waitForDeployment();
  const distributorAddress = await distributor.getAddress();
  console.log("RewardDistributor deployed to:", distributorAddress);

  // 3. Deploy StakingPool
  const StakingPool = await ethers.getContractFactory("StakingPool");
  const pool = await StakingPool.deploy(tokenAddress, distributorAddress);
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  console.log("StakingPool deployed to:", poolAddress);

  // 4. Configure StakingPool in RewardDistributor
  await distributor.setStakingPool(poolAddress);
  console.log("StakingPool configured in RewardDistributor.");

  // 5. Fund RewardDistributor with rewards (100,000 MST)
  const rewardsPool = ethers.parseUnits("100000", 18);
  await token.transfer(distributorAddress, rewardsPool);
  console.log("Funded RewardDistributor with 100,000 MST");

  // 6. Setup local test accounts
  const signers = await ethers.getSigners();
  const user1 = signers[1]; // Account #1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  const user2 = signers[2]; // Account #2: 0x3C44Cd3B2aE1525426130C26a5407833519C3D01

  console.log("User 1 address:", user1.address);
  console.log("User 2 address:", user2.address);

  // 7. Mint tokens to User 1 and User 2
  const mintAmount = ethers.parseUnits("10000", 18); // 10k MST each
  await token.mint(user1.address, mintAmount);
  await token.mint(user2.address, mintAmount);
  console.log("Minted 10,000 MST to User 1 and User 2.");

  // 8. User 1 stakes 2,500 MST
  const stake1 = ethers.parseUnits("2500", 18);
  await token.connect(user1).approve(poolAddress, stake1);
  await pool.connect(user1).stake(stake1);
  console.log("User 1 staked 2,500 MST.");

  // 9. User 2 stakes 5,000 MST
  const stake2 = ethers.parseUnits("5000", 18);
  await token.connect(user2).approve(poolAddress, stake2);
  await pool.connect(user2).stake(stake2);
  console.log("User 2 staked 5,000 MST.");

  // 10. Fast-forward time by 3 days (3 * 24 * 60 * 60 seconds)
  const threeDays = 3 * 24 * 60 * 60;
  await ethers.provider.send("evm_increaseTime", [threeDays]);
  await ethers.provider.send("evm_mine");
  console.log("Advanced network time by 3 days to accumulate rewards.");

  // 11. Print summary of balances and rewards
  const r1 = await distributor.calculateReward(user1.address);
  const r2 = await distributor.calculateReward(user2.address);

  console.log("\n--- Seeding Summary ---");
  console.log(`Token Address: ${tokenAddress}`);
  console.log(`StakingPool Address: ${poolAddress}`);
  console.log(`RewardDistributor Address: ${distributorAddress}`);
  console.log(`User 1 (${user1.address}): Staked = 2,500 MST, Accrued Reward = ${ethers.formatUnits(r1, 18)} MST`);
  console.log(`User 2 (${user2.address}): Staked = 5,000 MST, Accrued Reward = ${ethers.formatUnits(r2, 18)} MST`);
  console.log("-----------------------\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
