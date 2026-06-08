import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

describe("RewardDistributor", function () {
  let Token, RewardDistributor;
  let token, distributor;
  let owner, addr1, stakingPoolMock;
  const YEAR_IN_SECONDS = 365 * 24 * 60 * 60;

  beforeEach(async function () {
    [owner, addr1, stakingPoolMock] = await ethers.getSigners();
    
    // Deploy Token
    Token = await ethers.getContractFactory("MiniStakeToken");
    token = await Token.deploy();
    await token.waitForDeployment();

    // Deploy RewardDistributor
    RewardDistributor = await ethers.getContractFactory("RewardDistributor");
    distributor = await RewardDistributor.deploy(await token.getAddress());
    await distributor.waitForDeployment();

    // Fund RewardDistributor with rewards (100,000 MST)
    await token.transfer(await distributor.getAddress(), ethers.parseUnits("100000", 18));
  });

  describe("Deployment & Setup", function () {
    it("Should set correct token address", async function () {
      expect(await distributor.stakingToken()).to.equal(await token.getAddress());
    });

    it("Should allow owner to set staking pool address once", async function () {
      await expect(distributor.connect(owner).setStakingPool(stakingPoolMock.address))
        .to.emit(distributor, "StakingPoolSet")
        .withArgs(stakingPoolMock.address);

      expect(await distributor.stakingPool()).to.equal(stakingPoolMock.address);

      // Try setting it again
      await expect(
        distributor.connect(owner).setStakingPool(addr1.address)
      ).to.be.revertedWithCustomError(distributor, "StakingPoolAlreadySet");
    });

    it("Should fail if non-owner sets staking pool", async function () {
      await expect(
        distributor.connect(addr1).setStakingPool(addr1.address)
      ).to.be.reverted; // Ownable access control
    });
  });

  describe("Staking Balance Updates & Reward Logic", function () {
    beforeEach(async function () {
      // Set staking pool mock
      await distributor.connect(owner).setStakingPool(stakingPoolMock.address);
    });

    it("Should only allow staking pool to update state", async function () {
      const stakedAmount = ethers.parseUnits("1000", 18);
      await expect(
        distributor.connect(addr1).updateStakingState(addr1.address, stakedAmount)
      ).to.be.revertedWithCustomError(distributor, "OnlyStakingPool");
    });

    it("Should compute rewards correctly based on 12% APR after 1 year", async function () {
      const stakedAmount = ethers.parseUnits("1000", 18); // 1000 MST
      
      // Update state to start staking
      await distributor.connect(stakingPoolMock).updateStakingState(addr1.address, stakedAmount);
      
      // Fast forward 1 year (365 days)
      await ethers.provider.send("evm_increaseTime", [YEAR_IN_SECONDS]);
      await ethers.provider.send("evm_mine");

      // Staked = 1000, APR = 12%, Reward after 1 year = 120 MST
      const calculated = await distributor.calculateReward(addr1.address);
      const expected = ethers.parseUnits("120", 18); // 1000 * 0.12 = 120
      
      // Check for margin of error (within small difference due to seconds elapsed in block mining)
      const diff = calculated > expected ? calculated - expected : expected - calculated;
      expect(diff).to.be.lessThan(ethers.parseUnits("0.01", 18));
    });

    it("Should accumulate rewards correctly across multiple updates", async function () {
      const firstStake = ethers.parseUnits("1000", 18);
      await distributor.connect(stakingPoolMock).updateStakingState(addr1.address, firstStake);

      // Fast forward 6 months (half year)
      await ethers.provider.send("evm_increaseTime", [YEAR_IN_SECONDS / 2]);
      await ethers.provider.send("evm_mine");

      // Stake more: updates staking balance, checkpoints rewards
      const newStake = ethers.parseUnits("3000", 18); // total = 3000
      await distributor.connect(stakingPoolMock).updateStakingState(addr1.address, newStake);

      // Rewards accrued in first 6 months: 1000 * 12% * 0.5 = 60 MST
      expect(await distributor.accumulatedRewards(addr1.address)).to.be.closeTo(
        ethers.parseUnits("60", 18),
        ethers.parseUnits("0.01", 18)
      );

      // Fast forward another 6 months
      await ethers.provider.send("evm_increaseTime", [YEAR_IN_SECONDS / 2]);
      await ethers.provider.send("evm_mine");

      // Rewards accrued in second 6 months: 3000 * 12% * 0.5 = 180 MST
      // Total reward = 60 + 180 = 240 MST
      const totalReward = await distributor.calculateReward(addr1.address);
      expect(totalReward).to.be.closeTo(
        ethers.parseUnits("240", 18),
        ethers.parseUnits("0.02", 18)
      );
    });

    it("Should allow claiming rewards, increasing balance, and preventing double claim", async function () {
      const stakedAmount = ethers.parseUnits("1000", 18);
      await distributor.connect(stakingPoolMock).updateStakingState(addr1.address, stakedAmount);

      // Fast forward 1 year
      await ethers.provider.send("evm_increaseTime", [YEAR_IN_SECONDS]);
      await ethers.provider.send("evm_mine");

      const balanceBefore = await token.balanceOf(addr1.address);

      // Claim
      await expect(distributor.connect(addr1).claimReward())
        .to.emit(distributor, "RewardClaimed");

      const balanceAfter = await token.balanceOf(addr1.address);
      expect(balanceAfter - balanceBefore).to.be.closeTo(
        ethers.parseUnits("120", 18),
        ethers.parseUnits("0.05", 18)
      );

      // Try claiming again immediately: should revert as accumulated rewards were reset
      await expect(
        distributor.connect(addr1).claimReward()
      ).to.be.revertedWithCustomError(distributor, "NoRewardsToClaim");
    });

    it("Should reset rewards on emergency reset", async function () {
      const stakedAmount = ethers.parseUnits("1000", 18);
      await distributor.connect(stakingPoolMock).updateStakingState(addr1.address, stakedAmount);

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [YEAR_IN_SECONDS / 2]);
      await ethers.provider.send("evm_mine");

      // Call resetReward from pool
      await expect(distributor.connect(stakingPoolMock).resetReward(addr1.address))
        .to.emit(distributor, "RewardReset")
        .withArgs(addr1.address);

      expect(await distributor.calculateReward(addr1.address)).to.equal(0);
      expect(await distributor.accumulatedRewards(addr1.address)).to.equal(0);
      expect(await distributor.stakedBalance(addr1.address)).to.equal(0);
    });
  });
});
