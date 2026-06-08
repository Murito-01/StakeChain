// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RewardDistributor
 * @dev Computes and distributes APR-based rewards for the MiniStake platform.
 */
contract RewardDistributor is Ownable, ReentrancyGuard {
    // Staking Token interface
    IERC20 public immutable stakingToken;
    
    // Staking Pool address allowed to modify balances
    address public stakingPool;

    // APR representation: 12.00% (1200 basis points)
    // Gas optimization: use uint256 instead of smaller uint types to avoid extra compiler masking overhead
    uint256 public constant APR_BPS = 1200; 
    uint256 public constant BPS_DIVISOR = 10000;
    uint256 public constant YEAR_IN_SECONDS = 365 days;

    // User reward storage
    // Gas optimization: use uint256 instead of uint128 to avoid extra SLOAD and compiler masking overhead for standalone storage variables
    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public accumulatedRewards;
    mapping(address => uint256) public lastUpdateTime;

    // Custom errors for gas optimization
    // Gas optimization: use custom errors instead of require strings
    error OnlyStakingPool();
    error StakingPoolAlreadySet();
    error NoRewardsToClaim();
    error TransferFailed();
    error ZeroAddress();

    // Events
    event StakingPoolSet(address indexed pool);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardUpdated(address indexed user, uint256 accumulated, uint256 lastUpdateTime);
    event RewardReset(address indexed user);

    modifier onlyStakingPool() {
        if (msg.sender != stakingPool) revert OnlyStakingPool();
        _;
    }

    constructor(address _stakingToken) Ownable(msg.sender) {
        if (_stakingToken == address(0)) revert ZeroAddress();
        stakingToken = IERC20(_stakingToken);
    }

    /**
     * @dev Sets the StakingPool contract address. Can only be set once by the owner.
     * @param _stakingPool The address of the StakingPool contract.
     */
    function setStakingPool(address _stakingPool) external onlyOwner {
        if (_stakingPool == address(0)) revert ZeroAddress();
        if (stakingPool != address(0)) revert StakingPoolAlreadySet();
        stakingPool = _stakingPool;
        emit StakingPoolSet(_stakingPool);
    }

    /**
     * @dev Called by StakingPool to update the user's balance and checkpoint rewards.
     * @param user The address of the staker.
     * @param newBalance The new staked balance of the user.
     */
    function updateStakingState(address user, uint256 newBalance) external onlyStakingPool {
        // Gas optimization: cache storage variables to memory
        uint256 oldBalance = stakedBalance[user];
        uint256 lastUpdate = lastUpdateTime[user];
        
        uint256 accrued = 0;
        if (oldBalance > 0 && lastUpdate > 0) {
            // Gas optimization: use unchecked for math operations that cannot overflow/underflow
            unchecked {
                uint256 timeElapsed = block.timestamp - lastUpdate;
                accrued = (oldBalance * APR_BPS * timeElapsed) / (BPS_DIVISOR * YEAR_IN_SECONDS);
            }
        }

        // Gas optimization: use unchecked since balance and time are bounded and cannot overflow under normal operations
        unchecked {
            accumulatedRewards[user] += accrued;
        }
        
        lastUpdateTime[user] = block.timestamp;
        stakedBalance[user] = newBalance;

        emit RewardUpdated(user, accumulatedRewards[user], block.timestamp);
    }

    /**
     * @dev Called by StakingPool to reset user rewards on emergency withdrawal (forfeiting rewards).
     * @param user The address of the staker.
     */
    function resetReward(address user) external onlyStakingPool {
        accumulatedRewards[user] = 0;
        lastUpdateTime[user] = block.timestamp;
        stakedBalance[user] = 0;
        emit RewardReset(user);
    }

    /**
     * @dev View function to calculate total rewards (accumulated + pending).
     * @param user The address of the staker.
     * @return The total accrued rewards for the user.
     */
    function calculateReward(address user) public view returns (uint256) {
        // Gas optimization: cache storage variables to memory
        uint256 currentStaked = stakedBalance[user];
        uint256 lastUpdate = lastUpdateTime[user];
        uint256 accumulated = accumulatedRewards[user];

        if (currentStaked == 0 || lastUpdate == 0) {
            return accumulated;
        }

        uint256 pending = 0;
        // Gas optimization: use unchecked for simple subtraction and bounds check
        unchecked {
            if (block.timestamp > lastUpdate) {
                uint256 timeElapsed = block.timestamp - lastUpdate;
                pending = (currentStaked * APR_BPS * timeElapsed) / (BPS_DIVISOR * YEAR_IN_SECONDS);
            }
        }
        return accumulated + pending;
    }

    /**
     * @dev Claim accumulated rewards. Transfers rewards (MST) to the user.
     */
    function claimReward() external nonReentrant {
        // Checkpoint rewards first
        uint256 totalReward = calculateReward(msg.sender);
        if (totalReward == 0) revert NoRewardsToClaim();

        // Anti-double-claim protection: Reset rewards before transferring (Checks-Effects-Interactions)
        accumulatedRewards[msg.sender] = 0;
        lastUpdateTime[msg.sender] = block.timestamp;

        emit RewardClaimed(msg.sender, totalReward);

        // Transfer tokens
        bool success = stakingToken.transfer(msg.sender, totalReward);
        if (!success) revert TransferFailed();
    }
}
