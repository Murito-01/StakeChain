// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRewardDistributor {
    function updateStakingState(address user, uint256 newBalance) external;
    function resetReward(address user) external;
}

/**
 * @title StakingPool
 * @dev Core contract managing deposits, lockups, and emergency withdrawals.
 */
contract StakingPool is Ownable, ReentrancyGuard {
    // Staking Token interface
    IERC20 public immutable stakingToken;
    
    // Reward Distributor interface
    IRewardDistributor public immutable rewardDistributor;

    // Lock period duration (7 days)
    // Gas optimization: use uint256 instead of smaller uint types to avoid extra compiler masking overhead
    uint256 public constant LOCK_PERIOD = 7 days;

    // User staking info
    struct Staker {
        // Gas optimization: use uint256 instead of uint128 to avoid compiler masking overhead
        uint256 stakedAmount;
        uint256 lockedUntil;
    }

    // Gas optimization: use uint256 instead of uint128 to avoid extra SLOAD and compiler masking overhead for standalone storage variables
    mapping(address => Staker) public stakers;

    // Custom errors for gas optimization
    // Gas optimization: use custom errors instead of require strings
    error InvalidAmount();
    error LockPeriodActive(uint256 lockedUntil);
    error InsufficientStakedBalance();
    error TransferFailed();
    error ZeroAddress();

    // Events
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 amount);

    constructor(address _stakingToken, address _rewardDistributor) Ownable(msg.sender) {
        if (_stakingToken == address(0) || _rewardDistributor == address(0)) revert ZeroAddress();
        stakingToken = IERC20(_stakingToken);
        rewardDistributor = IRewardDistributor(_rewardDistributor);
    }

    /**
     * @dev Stake tokens in the pool. Sets/extends the lock-up period by 7 days.
     * @param amount The amount of tokens to stake.
     */
    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();

        // Gas optimization: cache storage variables to memory to avoid multiple SLOADs
        Staker memory userStaker = stakers[msg.sender];
        
        // Update user staker record
        // Gas optimization: use unchecked for addition since it will not overflow under reasonable supplies
        unchecked {
            userStaker.stakedAmount += amount;
        }
        userStaker.lockedUntil = block.timestamp + LOCK_PERIOD;
        
        // Write back to storage
        stakers[msg.sender] = userStaker;

        // Checkpoint rewards in RewardDistributor before changing balance
        rewardDistributor.updateStakingState(msg.sender, userStaker.stakedAmount);

        emit Staked(msg.sender, amount);

        // Transfer tokens from user to contract
        bool success = stakingToken.transferFrom(msg.sender, address(this), amount);
        if (!success) revert TransferFailed();
    }

    /**
     * @dev Unstake tokens after lock-up period has expired.
     * @param amount The amount of tokens to unstake.
     */
    function unstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();

        // Gas optimization: cache storage variables to memory to avoid multiple SLOADs
        Staker memory userStaker = stakers[msg.sender];

        if (amount > userStaker.stakedAmount) revert InsufficientStakedBalance();
        if (block.timestamp < userStaker.lockedUntil) revert LockPeriodActive(userStaker.lockedUntil);

        // Update user staker record
        // Gas optimization: use unchecked for subtraction since amount <= stakedAmount
        unchecked {
            userStaker.stakedAmount -= amount;
        }

        // Write back to storage
        stakers[msg.sender] = userStaker;

        // Checkpoint rewards in RewardDistributor before changing balance
        rewardDistributor.updateStakingState(msg.sender, userStaker.stakedAmount);

        emit Unstaked(msg.sender, amount);

        // Transfer tokens back to user
        bool success = stakingToken.transfer(msg.sender, amount);
        if (!success) revert TransferFailed();
    }

    /**
     * @dev Withdraw all staked tokens instantly, bypassing lock period, but forfeiting all accrued rewards.
     */
    function emergencyWithdraw() external nonReentrant {
        // Gas optimization: cache storage variables to memory to avoid multiple SLOADs
        Staker memory userStaker = stakers[msg.sender];
        uint256 withdrawAmount = userStaker.stakedAmount;

        if (withdrawAmount == 0) revert InsufficientStakedBalance();

        // Zero out staker storage
        delete stakers[msg.sender];

        // Reset user rewards in RewardDistributor (penalty: forfeit all rewards)
        rewardDistributor.resetReward(msg.sender);

        emit EmergencyWithdraw(msg.sender, withdrawAmount);

        // Transfer tokens back to user
        bool success = stakingToken.transfer(msg.sender, withdrawAmount);
        if (!success) revert TransferFailed();
    }
}
