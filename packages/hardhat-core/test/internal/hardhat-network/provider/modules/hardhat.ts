import { assert } from "chai";
import { BN, intToHex } from "ethereumjs-util";
import { ethers } from "ethers";
import sinon from "sinon";

import {
  numberToRpcQuantity,
  rpcQuantityToNumber,
} from "../../../../../src/internal/core/jsonrpc/types/base-types";
import { CompilerOutputContract } from "../../../../../src/types/artifacts";
import { expectErrorAsync } from "../../../../helpers/errors";
import { ALCHEMY_URL } from "../../../../setup";
import { workaroundWindowsCiFailures } from "../../../../utils/workaround-windows-ci-failures";
import {
  assertInvalidArgumentsError,
  assertInvalidInputError,
} from "../../helpers/assertions";
import { EMPTY_ACCOUNT_ADDRESS } from "../../helpers/constants";
import { setCWD } from "../../helpers/cwd";
import { DEFAULT_ACCOUNTS_ADDRESSES, PROVIDERS } from "../../helpers/providers";
import { deployContract } from "../../helpers/transactions";
import { compileLiteral } from "../../stack-traces/compilation";

describe("Hardhat module", function () {
  PROVIDERS.forEach(({ name, useProvider, isFork }) => {
    if (isFork) {
      this.timeout(50000);
    }

    workaroundWindowsCiFailures.call(this, { isFork });

    describe(`${name} provider`, function () {
      const safeBlockInThePast = 11_200_000; // this should resolve CI errors probably caused by using a block too far in the past

      setCWD();
      useProvider();

      describe("hardhat_impersonateAccount", function () {
        it("validates input parameter", async function () {
          await assertInvalidArgumentsError(
            this.provider,
            "hardhat_impersonateAccount",
            ["0x1234"]
          );

          await assertInvalidArgumentsError(
            this.provider,
            "hardhat_impersonateAccount",
            ["1234567890abcdef1234567890abcdef12345678"]
          );
        });

        it("returns true", async function () {
          const result = await this.provider.send(
            "hardhat_impersonateAccount",
            [EMPTY_ACCOUNT_ADDRESS.toString()]
          );
          assert.isTrue(result);
        });

        it("lets you send a transaction from an impersonated account", async function () {
          const impersonatedAddress =
            "0xC014BA5EC014ba5ec014Ba5EC014ba5Ec014bA5E";

          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: impersonatedAddress,
              value: "0x100",
            },
          ]);

          // The tx's msg.sender should be correct during execution

          // msg.sender assertion contract:
          //
          // pragma solidity 0.7.0;
          //
          // contract C {
          //     constructor() {
          //         require(msg.sender == 0xC014BA5EC014ba5ec014Ba5EC014ba5Ec014bA5E);
          //     }
          // }
          const CODE =
            "0x6080604052348015600f57600080fd5b5073c014ba5ec014ba5ec014ba5ec014ba5ec014ba5e73ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff1614605b57600080fd5b603f8060686000396000f3fe6080604052600080fdfea26469706673582212208048da4076c3540ec6ad48a816e6531a302449e979836bd7955dc6bd2c87a52064736f6c63430007000033";

          await this.provider.send("hardhat_impersonateAccount", [
            impersonatedAddress,
          ]);

          await expectErrorAsync(() =>
            deployContract(this.provider, CODE, DEFAULT_ACCOUNTS_ADDRESSES[0])
          );

          // deploying with the right address should work
          await deployContract(this.provider, CODE, impersonatedAddress);

          // Getting the tx through the RPC should give the right from

          const tx = await this.provider.send("eth_sendTransaction", [
            {
              from: impersonatedAddress,
              to: impersonatedAddress,
            },
          ]);

          const receipt = await this.provider.send(
            "eth_getTransactionReceipt",
            [tx]
          );

          assert.equal(receipt.from, impersonatedAddress.toLowerCase());
        });

        it("lets you deploy a contract from an impersonated account", async function () {
          const impersonatedAddress =
            "0xC014BA5EC014ba5ec014Ba5EC014ba5Ec014bA5E";

          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: impersonatedAddress,
              value: "0x100",
            },
          ]);

          await this.provider.send("hardhat_impersonateAccount", [
            impersonatedAddress,
          ]);

          await deployContract(
            this.provider,
            "0x7f410000000000000000000000000000000000000000000000000000000000000060005260016000f3",
            impersonatedAddress
          );
        });
      });

      describe("hardhat_stopImpersonatingAccount", function () {
        it("validates input parameter", async function () {
          await assertInvalidArgumentsError(
            this.provider,
            "hardhat_stopImpersonatingAccount",
            ["0x1234"]
          );

          await assertInvalidArgumentsError(
            this.provider,
            "hardhat_stopImpersonatingAccount",
            ["1234567890abcdef1234567890abcdef12345678"]
          );
        });

        it("returns true if the account was impersonated before", async function () {
          await this.provider.send("hardhat_impersonateAccount", [
            EMPTY_ACCOUNT_ADDRESS.toString(),
          ]);
          const result = await this.provider.send(
            "hardhat_stopImpersonatingAccount",
            [EMPTY_ACCOUNT_ADDRESS.toString()]
          );
          assert.isTrue(result);
        });

        it("returns false if the account wasn't impersonated before", async function () {
          const result = await this.provider.send(
            "hardhat_stopImpersonatingAccount",
            [EMPTY_ACCOUNT_ADDRESS.toString()]
          );
          assert.isFalse(result);
        });
      });

      describe("hardhat_reset", function () {
        before(function () {
          if (ALCHEMY_URL === undefined) {
            this.skip();
          }
        });

        it("validates input parameters", async function () {
          await assertInvalidArgumentsError(this.provider, "hardhat_reset", [
            { forking: {} },
          ]);

          await assertInvalidArgumentsError(this.provider, "hardhat_reset", [
            {
              forking: {
                jsonRpcUrl: 123,
              },
            },
          ]);

          await assertInvalidArgumentsError(this.provider, "hardhat_reset", [
            {
              forking: {
                blockNumber: 0,
              },
            },
          ]);

          await assertInvalidArgumentsError(this.provider, "hardhat_reset", [
            {
              forking: {
                jsonRpcUrl: ALCHEMY_URL,
                blockNumber: "0",
              },
            },
          ]);
        });

        it("returns true", async function () {
          const result = await this.provider.send("hardhat_reset", [
            {
              forking: {
                jsonRpcUrl: ALCHEMY_URL,
                blockNumber: safeBlockInThePast,
              },
            },
          ]);
          assert.isTrue(result);
        });

        it("hardhat_reset resets tx pool", async function () {
          await this.provider.send("evm_setAutomine", [false]);
          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[1],
              to: "0x1111111111111111111111111111111111111111",
              nonce: numberToRpcQuantity(0),
            },
          ]);

          const pendingTxsBefore = await this.provider.send(
            "eth_pendingTransactions"
          );

          const result = await this.provider.send("hardhat_reset");

          const pendingTxsAfter = await this.provider.send(
            "eth_pendingTransactions"
          );

          assert.isTrue(result);
          assert.lengthOf(pendingTxsBefore, 1);
          assert.lengthOf(pendingTxsAfter, 0);
        });

        describe("tests using sinon", () => {
          let sinonClock: sinon.SinonFakeTimers;

          beforeEach(() => {
            sinonClock = sinon.useFakeTimers({
              now: Date.now(),
              toFake: ["Date", "setTimeout", "clearTimeout"],
            });
          });

          afterEach(() => {
            sinonClock.restore();
          });

          it("resets interval mining", async function () {
            const interval = 15_000;

            await this.provider.send("evm_setAutomine", [false]);
            await this.provider.send("evm_setIntervalMining", [interval]);

            const firstBlockBefore = await getLatestBlockNumber();

            await sinonClock.tickAsync(interval);

            const secondBlockBefore = await getLatestBlockNumber();
            assert.equal(secondBlockBefore, firstBlockBefore + 1);

            const result = await this.provider.send("hardhat_reset");
            assert.isTrue(result);

            const firstBlockAfter = await getLatestBlockNumber();

            await sinonClock.tickAsync(interval);

            const secondBlockAfter = await getLatestBlockNumber();
            assert.equal(secondBlockAfter, firstBlockAfter);
          });
        });

        if (isFork) {
          testForkedProviderBehaviour();
        } else {
          testNormalProviderBehaviour();
        }

        const getLatestBlockNumber = async () => {
          return rpcQuantityToNumber(
            await this.ctx.provider.send("eth_blockNumber")
          );
        };

        function testForkedProviderBehaviour() {
          it("can reset the forked provider to a given forkBlockNumber", async function () {
            await this.provider.send("hardhat_reset", [
              {
                forking: {
                  jsonRpcUrl: ALCHEMY_URL,
                  blockNumber: safeBlockInThePast,
                },
              },
            ]);
            assert.equal(await getLatestBlockNumber(), safeBlockInThePast);
          });

          it("can reset the forked provider to the latest block number", async function () {
            const initialBlock = await getLatestBlockNumber();
            await this.provider.send("hardhat_reset", [
              {
                forking: {
                  jsonRpcUrl: ALCHEMY_URL,
                  blockNumber: safeBlockInThePast,
                },
              },
            ]);
            await this.provider.send("hardhat_reset", [
              { forking: { jsonRpcUrl: ALCHEMY_URL } },
            ]);

            // This condition is rather loose as Infura can sometimes return
            // a smaller block number on subsequent eth_blockNumber call
            assert.closeTo(await getLatestBlockNumber(), initialBlock, 4);
          });

          it("can reset the forked provider to a normal provider", async function () {
            await this.provider.send("hardhat_reset", []);
            assert.equal(await getLatestBlockNumber(), 0);

            await this.provider.send("hardhat_reset", [{}]);
            assert.equal(await getLatestBlockNumber(), 0);
          });
        }

        function testNormalProviderBehaviour() {
          it("can reset the provider to initial state", async function () {
            await this.provider.send("evm_mine");
            assert.equal(await getLatestBlockNumber(), 1);
            await this.provider.send("hardhat_reset", []);
            assert.equal(await getLatestBlockNumber(), 0);
          });

          it("can reset the provider with a fork config", async function () {
            await this.provider.send("hardhat_reset", [
              {
                forking: {
                  jsonRpcUrl: ALCHEMY_URL,
                  blockNumber: safeBlockInThePast,
                },
              },
            ]);
            assert.equal(await getLatestBlockNumber(), safeBlockInThePast);
          });

          it("can reset the provider with fork config back to normal config", async function () {
            await this.provider.send("hardhat_reset", [
              {
                forking: {
                  jsonRpcUrl: ALCHEMY_URL,
                  blockNumber: safeBlockInThePast,
                },
              },
            ]);
            await this.provider.send("hardhat_reset", []);
            assert.equal(await getLatestBlockNumber(), 0);
          });
        }
      });

      describe("hardhat_setBalance", function () {
        it("should reject an invalid address", async function () {
          await assertInvalidArgumentsError(
            this.provider,
            "hardhat_setBalance",
            ["0x1234", "0x0"],
            'Errors encountered in param 0: Invalid value "0x1234" supplied to : ADDRESS'
          );
        });

        it("should reject a non-numeric balance", async function () {
          await assertInvalidArgumentsError(
            this.provider,
            "hardhat_setBalance",
            [DEFAULT_ACCOUNTS_ADDRESSES[0].toString(), "xyz"],
            'Errors encountered in param 1: Invalid value "xyz" supplied to : QUANTITY'
          );
        });

        it("should not reject valid argument types", async function () {
          await this.provider.send("hardhat_setBalance", [
            DEFAULT_ACCOUNTS_ADDRESSES[0].toString(),
            "0x0",
          ]);
        });

        it("should result in a modified balance", async function () {
          // Arrange: Capture existing balance
          const existingBalance = rpcQuantityToBN(
            await this.provider.send("eth_getBalance", [
              DEFAULT_ACCOUNTS_ADDRESSES[0],
            ])
          );

          // Act: Set the new balance.
          const targetBalance = existingBalance.add(new BN(1)).mul(new BN(2));
          // For sanity, ensure that we really are making a change:
          assert.notDeepEqual(targetBalance, existingBalance);
          await this.provider.send("hardhat_setBalance", [
            DEFAULT_ACCOUNTS_ADDRESSES[0],
            numberToRpcQuantity(targetBalance),
          ]);

          // Assert: Ensure the new balance was set.
          const newBalance = rpcQuantityToBN(
            await this.provider.send("eth_getBalance", [
              DEFAULT_ACCOUNTS_ADDRESSES[0],
            ])
          );
          assert(targetBalance.eq(newBalance));
        });

        it("should not result in a modified state root", async function () {
          // Arrange 1: Send a transaction, in order to ensure a pre-existing
          // state root.
          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: "0x100",
            },
          ]);

          // Arrange 2: Capture the existing state root.
          const oldStateRoot = (
            await this.provider.send("eth_getBlockByNumber", ["latest", false])
          ).stateRoot;

          // Act: Set the new balance.
          await this.provider.send("hardhat_setBalance", [
            DEFAULT_ACCOUNTS_ADDRESSES[0],
            intToHex(99),
          ]);

          // Assert: Ensure state root hasn't changed.
          const newStateRoot = (
            await this.provider.send("eth_getBlockByNumber", ["latest", false])
          ).stateRoot;
          assert.equal(newStateRoot, oldStateRoot);
        });

        it("should get changed balance by block", async function () {
          // Arrange 1: Get current block number
          const currentBlockNumber = await this.provider.send(
            "eth_blockNumber"
          );

          // Arrange 2: Set a new balance
          const targetBalance = new BN("123454321");
          const targetBalanceHex = numberToRpcQuantity(targetBalance);
          await this.provider.send("hardhat_setBalance", [
            DEFAULT_ACCOUNTS_ADDRESSES[0],
            targetBalanceHex,
          ]);

          // Arrange 3: Mine a block
          await this.provider.send("evm_mine");

          // Act: Get the balance of the account in the previous block
          const balancePreviousBlock = await this.provider.send(
            "eth_getBalance",
            [DEFAULT_ACCOUNTS_ADDRESSES[0], currentBlockNumber]
          );

          // Assert: Check that the balance is the one we set
          assert.equal(balancePreviousBlock, targetBalanceHex);
        });

        it("should fund an account and permit that account to send a transaction", async function () {
          // Arrange: Fund a not-yet-existing account.
          const notYetExistingAccount =
            "0x1234567890123456789012345678901234567890";
          const amountToBeSent = new BN(10);
          const gasRequired = new BN("48000000000000000");
          const balanceRequired = amountToBeSent.add(gasRequired);
          await this.provider.send("hardhat_setBalance", [
            notYetExistingAccount,
            numberToRpcQuantity(balanceRequired),
          ]);

          // Arrange: Capture the existing balance of the destination account.
          const existingBalance = rpcQuantityToBN(
            await this.provider.send("eth_getBalance", [
              DEFAULT_ACCOUNTS_ADDRESSES[0],
            ])
          );

          // Act: Send a transaction from the newly-funded account.
          await this.provider.send("hardhat_impersonateAccount", [
            notYetExistingAccount,
          ]);
          await this.provider.send("eth_sendTransaction", [
            {
              from: notYetExistingAccount,
              to: DEFAULT_ACCOUNTS_ADDRESSES[0],
              value: numberToRpcQuantity(amountToBeSent),
            },
          ]);
          await this.provider.send("hardhat_stopImpersonatingAccount", [
            notYetExistingAccount,
          ]);

          // Assert: ensure the destination address is increased as expected.
          const newBalance = rpcQuantityToBN(
            await this.provider.send("eth_getBalance", [
              DEFAULT_ACCOUNTS_ADDRESSES[0],
            ])
          );

          assert(newBalance.eq(existingBalance.add(amountToBeSent)));
        });
      });

      describe("hardhat_setCode", function () {
        let contractNine: CompilerOutputContract;
        let abiEncoder: ethers.utils.Interface;
        before(async function () {
          [
            ,
            {
              contracts: {
                ["literal.sol"]: { Nine: contractNine },
              },
            },
          ] = await compileLiteral(`
            contract Nine {
                function returnNine() public pure returns (int) { return 9; }
            }
          `);
          abiEncoder = new ethers.utils.Interface(contractNine.abi);
        });

        it("should reject an invalid address", async function () {
          await assertInvalidArgumentsError(
            this.provider,
            "hardhat_setCode",
            ["0x1234", "0x0"],
            'Errors encountered in param 0: Invalid value "0x1234" supplied to : ADDRESS'
          );
        });

        it("should reject an invalid data argument", async function () {
          await assertInvalidArgumentsError(
            this.provider,
            "hardhat_setCode",
            [DEFAULT_ACCOUNTS_ADDRESSES[0].toString(), "xyz"],
            'Errors encountered in param 1: Invalid value "xyz" supplied to : DATA'
          );
        });

        it("should not reject valid argument types", async function () {
          await this.provider.send("hardhat_setCode", [
            DEFAULT_ACCOUNTS_ADDRESSES[0].toString(),
            "0xff",
          ]);
        });

        it("should result in modified code", async function () {
          const targetCode = "0x0123456789abcdef";
          await this.provider.send("hardhat_setCode", [
            DEFAULT_ACCOUNTS_ADDRESSES[0].toString(),
            targetCode,
          ]);

          const actualCode = await this.provider.send("eth_getCode", [
            DEFAULT_ACCOUNTS_ADDRESSES[0].toString(),
            "latest",
          ]);

          assert.equal(actualCode, targetCode);
        });

        it("should, when setting code on an empty account, result in code that can actually be executed", async function () {
          const notYetExistingAccount =
            "0x1234567890123456789012345678901234567890";

          await this.provider.send("hardhat_setCode", [
            notYetExistingAccount,
            `0x${contractNine.evm.deployedBytecode.object}`,
          ]);

          assert.equal(
            await this.provider.send("eth_call", [
              {
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                to: notYetExistingAccount,
                data: abiEncoder.encodeFunctionData("returnNine", []),
              },
              "latest",
            ]),
            abiEncoder.encodeFunctionResult("returnNine", [9])
          );
        });

        it("should, when setting code on an existing EOA, result in code that can actually be executed", async function () {
          await this.provider.send("hardhat_setCode", [
            DEFAULT_ACCOUNTS_ADDRESSES[0].toString(),
            `0x${contractNine.evm.deployedBytecode.object}`,
          ]);

          assert.equal(
            await this.provider.send("eth_call", [
              {
                from: DEFAULT_ACCOUNTS_ADDRESSES[1],
                to: DEFAULT_ACCOUNTS_ADDRESSES[0],
                data: abiEncoder.encodeFunctionData("returnNine", []),
              },
              "latest",
            ]),
            abiEncoder.encodeFunctionResult("returnNine", [9])
          );
        });

        it("should, when setting code on an existing contract account, result in code that can actually be executed", async function () {
          // Arrange: Deploy a contract that always returns 10.
          const [
            ,
            {
              contracts: {
                ["literal.sol"]: { Ten: contractTen },
              },
            },
          ] = await compileLiteral(`
            contract Ten {
              function returnTen() public pure returns (int) { return 10; }
            }
          `);
          const contractTenAddress = await deployContract(
            this.provider,
            `0x${contractTen.evm.bytecode.object}`,
            DEFAULT_ACCOUNTS_ADDRESSES[0]
          );

          // Act: Replace the code at that address to always return 9.
          await this.provider.send("hardhat_setCode", [
            contractTenAddress,
            `0x${contractNine.evm.deployedBytecode.object}`,
          ]);

          // Assert: Verify the call to get 9.
          assert.equal(
            await this.provider.send("eth_call", [
              {
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                to: contractTenAddress,
                data: abiEncoder.encodeFunctionData("returnNine", []),
              },
              "latest",
            ]),
            abiEncoder.encodeFunctionResult("returnNine", [9])
          );
        });

        it("should not result in a modified state root", async function () {
          // Arrange 1: Send a transaction, in order to ensure a pre-existing
          // state root.
          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: "0x100",
            },
          ]);

          // Arrange 2: Capture the existing state root.
          const oldStateRoot = (
            await this.provider.send("eth_getBlockByNumber", ["latest", false])
          ).stateRoot;

          // Act: Set the new code.
          await this.provider.send("hardhat_setCode", [
            DEFAULT_ACCOUNTS_ADDRESSES[0],
            "0x0123456789abcdef",
          ]);

          // Assert: Ensure state root hasn't changed.
          const newStateRoot = (
            await this.provider.send("eth_getBlockByNumber", ["latest", false])
          ).stateRoot;
          assert.equal(newStateRoot, oldStateRoot);
        });
      });

      describe("hardhat_setNonce", function () {
        it("should reject an invalid address", async function () {
          await assertInvalidArgumentsError(
            this.provider,
            "hardhat_setNonce",
            ["0x1234", "0x0"],
            'Errors encountered in param 0: Invalid value "0x1234" supplied to : ADDRESS'
          );
        });

        it("should reject a non-numeric nonce", async function () {
          await assertInvalidArgumentsError(
            this.provider,
            "hardhat_setNonce",
            [DEFAULT_ACCOUNTS_ADDRESSES[0].toString(), "xyz"],
            'Errors encountered in param 1: Invalid value "xyz" supplied to : QUANTITY'
          );
        });

        it("should not reject valid argument types", async function () {
          await this.provider.send("hardhat_setNonce", [
            DEFAULT_ACCOUNTS_ADDRESSES[0].toString(),
            "0x0",
          ]);
        });

        it("should throw an InvalidInputError if new nonce is smaller than the current nonce", async function () {
          // Arrange: Send a transaction, in order to ensure a non-zero nonce.
          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: "0x100",
            },
          ]);

          // Act & Assert: Ensure that a zero nonce now triggers the error.
          await assertInvalidInputError(
            this.provider,
            "hardhat_setNonce",
            [DEFAULT_ACCOUNTS_ADDRESSES[0], "0x0"],
            "New nonce must not be smaller than the existing nonce"
          );
        });

        it("should result in a modified nonce", async function () {
          // Arrange: Send a transaction, in order to ensure a non-zero nonce.
          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: "0x100",
            },
          ]);

          // Act: Set the new nonce.
          const targetNonce = 99;
          await this.provider.send("hardhat_setNonce", [
            DEFAULT_ACCOUNTS_ADDRESSES[0],
            intToHex(targetNonce),
          ]);

          // Assert: Ensure nonce got set.
          const resultingNonce = await this.provider.send(
            "eth_getTransactionCount",
            [DEFAULT_ACCOUNTS_ADDRESSES[0], "latest"]
          );
          assert.equal(resultingNonce, targetNonce);
        });

        it("should not result in a modified state root", async function () {
          // Arrange 1: Send a transaction, in order to ensure a non-zero nonce.
          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: "0x100",
            },
          ]);

          // Arrange 2: Capture the existing state root.
          const oldStateRoot = (
            await this.provider.send("eth_getBlockByNumber", ["latest", false])
          ).stateRoot;

          // Act: Set the new nonce.
          await this.provider.send("hardhat_setNonce", [
            DEFAULT_ACCOUNTS_ADDRESSES[0],
            intToHex(99),
          ]);

          // Assert: Ensure state root hasn't changed.
          const newStateRoot = (
            await this.provider.send("eth_getBlockByNumber", ["latest", false])
          ).stateRoot;
          assert.equal(newStateRoot, oldStateRoot);
        });

        it("should not break a subsequent transaction", async function () {
          // Arrange: Send a transaction, in order to ensure a non-zero nonce.
          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: "0x100",
            },
          ]);

          // Act: Set the new nonce and execute a transaction.

          const targetNonce = 99;
          await this.provider.send("hardhat_setNonce", [
            DEFAULT_ACCOUNTS_ADDRESSES[0],
            intToHex(targetNonce),
          ]);

          const txHash = await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: "0x100",
            },
          ]);

          // Assert: The executed transaction should reflects the nonce we set.
          assert.equal(
            (await this.provider.send("eth_getTransactionByHash", [txHash]))
              .nonce,
            targetNonce
          );
        });
      });

      describe("hardhat_setStorageSlot", function () {
        it("should reject an invalid address", async function () {
          await assertInvalidArgumentsError(
            this.provider,
            "hardhat_setStorageSlot",
            ["0x1234", intToHex(0), intToHex(99)],
            'Errors encountered in param 0: Invalid value "0x1234" supplied to : ADDRESS'
          );
        });

        it("should reject storage key that is non-numeric", async function () {
          await assertInvalidArgumentsError(
            this.provider,
            "hardhat_setStorageSlot",
            [DEFAULT_ACCOUNTS_ADDRESSES[0].toString(), "xyz", intToHex(99)],
            'Errors encountered in param 1: Invalid value "xyz" supplied to : QUANTITY'
          );
        });

        it("should reject a storage key that is greater than 32 bytes", async function () {
          const MAX_WORD_VALUE = new BN(2).pow(new BN(256));
          await assertInvalidInputError(
            this.provider,
            "hardhat_setStorageSlot",
            [
              DEFAULT_ACCOUNTS_ADDRESSES[0].toString(),
              numberToRpcQuantity(MAX_WORD_VALUE.add(new BN(1))),
              "0xff",
            ],
            "Storage key must not be greater than 2^256"
          );
        });

        for (const badInputLength of [1, 2, 31, 33, 64]) {
          it(`should reject a value that is ${badInputLength} (not exactly 32) bytes long`, async function () {
            await assertInvalidInputError(
              this.provider,
              "hardhat_setStorageSlot",
              [
                DEFAULT_ACCOUNTS_ADDRESSES[0].toString(),
                intToHex(0),
                `0x${"ff".repeat(badInputLength)}`,
              ],
              "Storage value must be exactly 32 bytes long"
            );
          });
        }

        it("should not reject valid argument types", async function () {
          await this.provider.send("hardhat_setStorageSlot", [
            DEFAULT_ACCOUNTS_ADDRESSES[0].toString(),
            intToHex(0),
            `0x${"ff".repeat(32)}`,
          ]);
        });

        it("should result in modified storage", async function () {
          const targetStorageSlot = 1;
          const targetStorageValue = 99;
          await this.provider.send("hardhat_setStorageSlot", [
            DEFAULT_ACCOUNTS_ADDRESSES[0],
            intToHex(0),
            `0x${new BN(targetStorageValue).toString(16, 64)}`,
          ]);

          const resultingStorageValue = await this.provider.send(
            "eth_getStorageAt",
            [DEFAULT_ACCOUNTS_ADDRESSES[0], intToHex(0), "latest"]
          );

          assert.equal(resultingStorageValue, targetStorageValue);
        });

        it("should permit a contract call to read an updated storage slot value", async function () {
          // Arrange: Deploy a contract that can get and set storage.
          const [
            ,
            {
              contracts: {
                ["literal.sol"]: { Storage: storageContract },
              },
            },
          ] = await compileLiteral(
            `contract Storage {
              function getValue(uint256 slot) public view returns (uint256 result) {
                assembly { result := sload(slot) }
              }
              function setValue(uint256 slot, uint256 val) public {
                assembly { sstore(slot, val) }
              }
            }`
          );
          const contractAddress = await deployContract(
            this.provider,
            `0x${storageContract.evm.bytecode.object}`,
            DEFAULT_ACCOUNTS_ADDRESSES[0]
          );

          // Act: Modify the value in the existing storage slot.
          await this.provider.send("hardhat_setStorageSlot", [
            contractAddress,
            intToHex(0),
            `0x${new BN(10).toString(16, 64)}`,
          ]);

          // Assert: Verify that the contract retrieves the modified value.
          const abiEncoder = new ethers.utils.Interface(storageContract.abi);
          assert.equal(
            await this.provider.send("eth_call", [
              {
                from: DEFAULT_ACCOUNTS_ADDRESSES[0],
                to: contractAddress,
                data: abiEncoder.encodeFunctionData("getValue", [0]),
              },
              "latest",
            ]),
            abiEncoder.encodeFunctionResult("getValue", [10])
          );
        });

        it("should not result in a modified state root", async function () {
          // Arrange 1: Send a transaction, in order to ensure a pre-existing
          // state root.
          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: DEFAULT_ACCOUNTS_ADDRESSES[1],
              value: "0x100",
            },
          ]);

          // Arrange 2: Capture the existing state root.
          const oldStateRoot = (
            await this.provider.send("eth_getBlockByNumber", ["latest", false])
          ).stateRoot;

          // Act: Set the new storage value.
          await this.provider.send("hardhat_setStorageSlot", [
            DEFAULT_ACCOUNTS_ADDRESSES[0],
            intToHex(0),
            `0x${"ff".repeat(32)}`,
          ]);

          // Assert: Ensure state root hasn't changed.
          const newStateRoot = (
            await this.provider.send("eth_getBlockByNumber", ["latest", false])
          ).stateRoot;
          assert.equal(newStateRoot, oldStateRoot);
        });
      });
    });
  });
});
