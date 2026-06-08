import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

describe("MiniStakeToken (MST)", function () {
  let Token;
  let token;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    Token = await ethers.getContractFactory("MiniStakeToken");
    token = await Token.deploy();
    await token.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      expect(await token.name()).to.equal("MiniStake Token");
      expect(await token.symbol()).to.equal("MST");
    });

    it("Should assign the initial supply to the owner", async function () {
      const ownerBalance = await token.balanceOf(owner.address);
      const totalSupply = await token.totalSupply();
      expect(ownerBalance).to.equal(totalSupply);
      expect(totalSupply).to.equal(ethers.parseUnits("1000000", 18));
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint new tokens", async function () {
      const mintAmount = ethers.parseUnits("5000", 18);
      await expect(token.connect(owner).mint(addr1.address, mintAmount))
        .to.emit(token, "Transfer")
        .withArgs(ethers.ZeroAddress, addr1.address, mintAmount);

      expect(await token.balanceOf(addr1.address)).to.equal(mintAmount);
    });

    it("Should fail if non-owner tries to mint", async function () {
      const mintAmount = ethers.parseUnits("5000", 18);
      // OpenZeppelin's Ownable reverts with custom error OwnableUnauthorizedAccount(address) in v5
      await expect(
        token.connect(addr1).mint(addr2.address, mintAmount)
      ).to.be.reverted;
    });
  });

  describe("Burning", function () {
    it("Should allow users to burn their own tokens", async function () {
      // First transfer some tokens to addr1
      const transferAmount = ethers.parseUnits("1000", 18);
      await token.transfer(addr1.address, transferAmount);

      const burnAmount = ethers.parseUnits("400", 18);
      await expect(token.connect(addr1).burn(burnAmount))
        .to.emit(token, "Transfer")
        .withArgs(addr1.address, ethers.ZeroAddress, burnAmount);

      expect(await token.balanceOf(addr1.address)).to.equal(
        transferAmount - burnAmount
      );
    });

    it("Should fail to burn 0 tokens", async function () {
      // Custom error InvalidAmount()
      await expect(token.burn(0)).to.be.revertedWithCustomError(
        token,
        "InvalidAmount"
      );
    });

    it("Should fail if burning more than balance", async function () {
      const excessAmount = ethers.parseUnits("2000000", 18);
      await expect(token.burn(excessAmount)).to.be.reverted;
    });
  });
});
