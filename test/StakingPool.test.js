import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

describe("StakingPool", function () {
  let Token, RewardDistributor, StakingPool;
  let token, distributor, pool;
  let owner, addr1, addr2;
  const LOCK_PERIOD = 7 * 24 * 60 * 60; // 7 days

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    // Deploy MST Token
    Token = await ethers.getContractFactory("MiniStakeToken");
    token = await Token.deploy();
    await token.waitForDeployment();

    // Deploy RewardDistributor
    RewardDistributor = await ethers.getContractFactory("RewardDistributor");
    distributor = await RewardDistributor.deploy(await token.getAddress());
    await distributor.waitForDeployment();

    // Deploy StakingPool
    StakingPool = await ethers.getContractFactory("StakingPool");
    pool = await StakingPool.deploy(await token.getAddress(), await distributor.getAddress());
    await pool.waitForDeployment();

    // Set StakingPool in RewardDistributor
    await distributor.setStakingPool(await pool.getAddress());

    // Mint and transfer tokens to addr1 for testing
    const testAmount = ethers.parseUnits("5000", 18);
    await token.transfer(addr1.address, testAmount);

    // Fund RewardDistributor with rewards
    await token.transfer(await distributor.getAddress(), ethers.parseUnits("50000", 18));
  });

  describe("Deployment & Configuration", function () {
    it("Should initialize with correct token and distributor address", async function () {
      expect(await pool.stakingToken()).to.equal(await token.getAddress());
      expect(await pool.rewardDistributor()).to.equal(await distributor.getAddress());
    });
  });

  describe("Staking", function () {
    it("Should allow a user to stake MST", async function () {
      const stakeAmount = ethers.parseUnits("1000", 18);
      
      // Approve pool to spend tokens
      await token.connect(addr1).approve(await pool.getAddress(), stakeAmount);

      // Stake
      await expect(pool.connect(addr1).stake(stakeAmount))
        .to.emit(pool, "Staked")
        .withArgs(addr1.address, stakeAmount);

      // Verify staker record
      const staker = await pool.stakers(addr1.address);
      expect(staker.stakedAmount).to.equal(stakeAmount);
      
      // Verify pool balance increases
      expect(await token.balanceOf(await pool.getAddress())).to.equal(stakeAmount);
      
      // Verify user balance decreases
      expect(await token.balanceOf(addr1.address)).to.equal(ethers.parseUnits("4000", 18));

      // Verify RewardDistributor reflects the balance
      expect(await distributor.stakedBalance(addr1.address)).to.equal(stakeAmount);
    });

    it("Should fail if staking 0 tokens", async function () {
      await expect(
        pool.connect(addr1).stake(0)
      ).to.be.revertedWithCustomError(pool, "InvalidAmount");
    });

    it("Should fail if staker has insufficient balance", async function () {
      const hugeAmount = ethers.parseUnits("10000", 18);
      await token.connect(addr1).approve(await pool.getAddress(), hugeAmount);

      await expect(
        pool.connect(addr1).stake(hugeAmount)
      ).to.be.reverted; // ERC20 insufficient balance
    });
  });

  describe("Unstaking & Lockups", function () {
    const stakeAmount = ethers.parseUnits("1000", 18);

    beforeEach(async function () {
      await token.connect(addr1).approve(await pool.getAddress(), stakeAmount);
      await pool.connect(addr1).stake(stakeAmount);
    });

    it("Should prevent unstaking before lock period", async function () {
      await expect(
        pool.connect(addr1).unstake(stakeAmount)
      ).to.be.revertedWithCustomError(pool, "LockPeriodActive");
    });

    it("Should allow unstaking after lock period has passed", async function () {
      // Fast forward time by 7 days
      await ethers.provider.send("evm_increaseTime", [LOCK_PERIOD + 1]);
      await ethers.provider.send("evm_mine");

      const withdrawAmount = ethers.parseUnits("400", 18);
      
      await expect(pool.connect(addr1).unstake(withdrawAmount))
        .to.emit(pool, "Unstaked")
        .withArgs(addr1.address, withdrawAmount);

      const staker = await pool.stakers(addr1.address);
      expect(staker.stakedAmount).to.equal(stakeAmount - withdrawAmount);
      
      // Check wallet balance
      expect(await token.balanceOf(addr1.address)).to.equal(ethers.parseUnits("4000", 18) + withdrawAmount);
    });

    it("Should fail if unstaking more than staked balance", async function () {
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [LOCK_PERIOD + 1]);
      await ethers.provider.send("evm_mine");

      const excessAmount = ethers.parseUnits("1200", 18);
      await expect(
        pool.connect(addr1).unstake(excessAmount)
      ).to.be.revertedWithCustomError(pool, "InsufficientStakedBalance");
    });
  });

  describe("Emergency Withdraw", function () {
    const stakeAmount = ethers.parseUnits("1000", 18);

    beforeEach(async function () {
      await token.connect(addr1).approve(await pool.getAddress(), stakeAmount);
      await pool.connect(addr1).stake(stakeAmount);
      
      // Let some time pass so rewards accumulate
      await ethers.provider.send("evm_increaseTime", [LOCK_PERIOD / 2]);
      await ethers.provider.send("evm_mine");
    });

    it("Should allow emergency withdraw bypassing lock duration", async function () {
      // Emergency withdraw should return all principal tokens to staker
      const walletBefore = await token.balanceOf(addr1.address);

      await expect(pool.connect(addr1).emergencyWithdraw())
        .to.emit(pool, "EmergencyWithdraw")
        .withArgs(addr1.address, stakeAmount);

      const walletAfter = await token.balanceOf(addr1.address);
      expect(walletAfter).to.equal(walletBefore + stakeAmount);

      // Verify staker record is deleted
      const staker = await pool.stakers(addr1.address);
      expect(staker.stakedAmount).to.equal(0);
      expect(staker.lockedUntil).to.equal(0);
    });

    it("Should forfeit all rewards upon emergency withdraw", async function () {
      // Call emergency withdraw
      await pool.connect(addr1).emergencyWithdraw();

      // Verify rewards are zeroed out in distributor
      expect(await distributor.calculateReward(addr1.address)).to.equal(0);
      expect(await distributor.accumulatedRewards(addr1.address)).to.equal(0);
    });

    it("Should fail if user has nothing staked", async function () {
      await expect(
        pool.connect(addr2).emergencyWithdraw()
      ).to.be.revertedWithCustomError(pool, "InsufficientStakedBalance");
    });
  });
});
