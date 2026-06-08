// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MiniStakeToken
 * @dev MiniStake Token (MST) - Standard ERC-20 contract for staking.
 */
contract MiniStakeToken is ERC20, Ownable {
    // Custom errors for gas optimization
    // Gas optimization: use custom errors instead of require strings
    error InvalidAmount();
    error ZeroAddress();

    /**
     * @dev Constructor that mints an initial supply to the deployer.
     */
    constructor() ERC20("MiniStake Token", "MST") Ownable(msg.sender) {
        // Initial supply of 1,000,000 MST minted to owner/deployer for pool funding
        // Gas optimization: use uint256 instead of smaller uint types to avoid extra compiler masking overhead
        uint256 initialSupply = 1_000_000 * 10**decimals();
        _mint(msg.sender, initialSupply);
    }

    /**
     * @dev Owner-only minting function.
     * @param to The address to receive minted tokens.
     * @param amount The amount of tokens to mint.
     */
    function mint(address to, uint256 amount) external onlyOwner {
        // Gas optimization: use custom errors instead of require strings
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        _mint(to, amount);
    }

    /**
     * @dev Public burning function allowing users to burn their own tokens.
     * @param amount The amount of tokens to burn.
     */
    function burn(uint256 amount) external {
        // Gas optimization: use custom errors instead of require strings
        if (amount == 0) revert InvalidAmount();

        _burn(msg.sender, amount);
    }
}
