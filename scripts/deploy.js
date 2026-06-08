import pkg from "hardhat";
const { ethers } = pkg;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // Deploy MST
  const MiniStakeToken = await ethers.getContractFactory("MiniStakeToken");
  const token = await MiniStakeToken.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("MiniStakeToken deployed to:", tokenAddress);

  // Deploy RewardDistributor
  const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
  const distributor = await RewardDistributor.deploy(tokenAddress);
  await distributor.waitForDeployment();
  const distributorAddress = await distributor.getAddress();
  console.log("RewardDistributor deployed to:", distributorAddress);

  // Deploy StakingPool
  const StakingPool = await ethers.getContractFactory("StakingPool");
  const pool = await StakingPool.deploy(tokenAddress, distributorAddress);
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  console.log("StakingPool deployed to:", poolAddress);

  // Set StakingPool in RewardDistributor
  await distributor.setStakingPool(poolAddress);
  console.log("StakingPool address configured in RewardDistributor");

  // Transfer 50,000 MST to RewardDistributor to fund rewards pool
  const fundAmount = ethers.parseUnits("50000", 18);
  await token.transfer(distributorAddress, fundAmount);
  console.log("Funded RewardDistributor with 50,000 MST for rewards");

  console.log("Deployment complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
