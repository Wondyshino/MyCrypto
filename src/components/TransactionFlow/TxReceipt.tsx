import React, {
  Dispatch,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useState
} from 'react';

import { Link, RouteComponentProps, withRouter } from 'react-router-dom';
import styled from 'styled-components';

import zapperLogo from '@assets/images/defizap/zapperLogo.svg';
import receiveIcon from '@assets/images/icn-receive.svg';
import sentIcon from '@assets/images/icn-sent.svg';
import {
  Amount,
  AssetIcon,
  Button,
  LinkOut,
  NewTabLink,
  PoweredByText,
  TimeElapsed,
  Tooltip
} from '@components';
import { FAUCET_ADDRESS, getWalletConfig, ROUTE_PATHS } from '@config';
import { getFiat } from '@config/fiats';
import ProtocolTagsList from '@features/DeFiZap/components/ProtocolTagsList';
import { ProtectTxAbort } from '@features/ProtectTransaction/components/ProtectTxAbort';
import { ProtectTxContext } from '@features/ProtectTransaction/ProtectTxProvider';
import MembershipReceiptBanner from '@features/PurchaseMembership/components/MembershipReceiptBanner';
import { SwapDisplayData } from '@features/SwapAssets/types';
import { fetchGasPriceEstimates, useRates } from '@services';
import {
  getTimestampFromBlockNum,
  getTransactionReceiptFromHash,
  ProviderHandler
} from '@services/EthService';
import { getStoreAccount, StoreContext, useAccounts, useContacts, useSettings } from '@services/Store';
import { BREAK_POINTS } from '@theme';
import translate, { translateRaw } from '@translations';
import {
  ExtendedContact,
  Fiat,
  IPendingTxReceipt,
  ISettings,
  IStepComponentProps,
  ITxHistoryStatus,
  ITxReceipt,
  ITxReceiptStepProps,
  ITxStatus,
  ITxType,
  TAddress,
  TxQueryTypes,
  WalletId
} from '@types';
import { convertToFiat, isWeb3Wallet, truncate } from '@utils';
import { constructCancelTxQuery, constructSpeedUpTxQuery } from '@utils/queries';
import { makeFinishedTxReceipt } from '@utils/transaction';
import { path } from '@vendor';

import { FromToAccount, SwapFromToDiagram, TransactionDetailsDisplay } from './displays';
import TxIntermediaryDisplay from './displays/TxIntermediaryDisplay';
import { calculateReplacementGasPrice, constructSenderFromTxConfig } from './helpers';
import { PendingTransaction } from './PendingLoader';
import { ISender } from './types';
import './TxReceipt.scss';

interface PendingBtnAction {
  text: string;
  action(cb: any): void;
}
interface Props {
  pendingButton?: PendingBtnAction;
  swapDisplay?: SwapDisplayData;
  disableDynamicTxReceiptDisplay?: boolean;
  disableAddTxToAccount?: boolean;
  protectTxButton?(): JSX.Element;
}

const SImg = styled('img')`
  height: ${(p: { size: string }) => p.size};
  width: ${(p: { size: string }) => p.size};
`;

const SSpacer = styled.div`
  height: 60px;
  @media screen and (max-width: ${BREAK_POINTS.SCREEN_XS}) {
    height: 85px;
  }
`;

const TxReceipt = ({
  txReceipt,
  txConfig,
  txQueryType,
  completeButtonText,
  membershipSelected,
  zapSelected,
  swapDisplay,
  disableDynamicTxReceiptDisplay,
  disableAddTxToAccount,
  history,
  resetFlow,
  protectTxButton
}: ITxReceiptStepProps & RouteComponentProps & Props) => {
  const { getAssetRate } = useRates();
  const { getContactByAddressAndNetworkId } = useContacts();
  const { addTxToAccount } = useAccounts();
  const { accounts } = useContext(StoreContext);
  const { settings } = useSettings();
  const [txStatus, setTxStatus] = useState(
    txReceipt ? txReceipt.status : (ITxStatus.PENDING as ITxHistoryStatus)
  );
  const [displayTxReceipt, setDisplayTxReceipt] = useState<ITxReceipt | undefined>(txReceipt);
  const [blockNumber, setBlockNumber] = useState(0);
  const [timestamp, setTimestamp] = useState(0);

  // Imported in this way to handle errors where the context is missing, f.x. in Swap Flow
  const { state: ptxState } = useContext(ProtectTxContext);

  useEffect(() => {
    if (!disableDynamicTxReceiptDisplay) {
      setDisplayTxReceipt(txReceipt);
    }
  }, [setDisplayTxReceipt, txReceipt]);

  useEffect(() => {
    if (displayTxReceipt && blockNumber === 0 && displayTxReceipt.hash) {
      const provider = new ProviderHandler(txConfig.network);
      const blockNumInterval = setInterval(() => {
        getTransactionReceiptFromHash(displayTxReceipt.hash, provider).then(
          (transactionOutcome) => {
            if (transactionOutcome) {
              const transactionStatus: ITxHistoryStatus =
                transactionOutcome.status === 1 ? ITxStatus.SUCCESS : ITxStatus.FAILED;
              setTxStatus((prevStatusState) => transactionStatus || prevStatusState);
              setBlockNumber((prevState: number) => transactionOutcome.blockNumber || prevState);
              provider.getTransactionByHash(displayTxReceipt.hash).then((txResponse) => {
                setDisplayTxReceipt(
                  makeFinishedTxReceipt(
                    txReceipt as IPendingTxReceipt,
                    transactionStatus,
                    txResponse.timestamp,
                    txResponse.blockNumber,
                    transactionOutcome.gasUsed,
                    transactionOutcome.confirmations
                  )
                );
              });
            } else if (txStatus === ITxStatus.UNKNOWN) {
              setTxStatus(ITxStatus.PENDING);
            }
          }
        );
      }, 1000);
      return () => clearInterval(blockNumInterval);
    }
  });
  useEffect(() => {
    if (displayTxReceipt && timestamp === 0 && blockNumber !== 0) {
      const provider = new ProviderHandler(txConfig.network);
      const timestampInterval = setInterval(() => {
        getTimestampFromBlockNum(blockNumber, provider).then((transactionTimestamp) => {
          if (txReceipt && txReceipt.txType === ITxType.FAUCET) {
            const recipientAccount = getStoreAccount(accounts)(txReceipt.to, txConfig.network.id);
            if (recipientAccount) {
              addTxToAccount(recipientAccount, {
                ...displayTxReceipt,
                blockNumber: blockNumber || 0,
                timestamp: transactionTimestamp || 0,
                status: txStatus
              });
            }
          } else if (sender.account && !disableAddTxToAccount) {
            addTxToAccount(sender.account, {
              ...displayTxReceipt,
              blockNumber: blockNumber || 0,
              timestamp: transactionTimestamp || 0,
              status: txStatus
            });
          }
          setTimestamp(transactionTimestamp || 0);
        });
      }, 1000);

      return () => clearInterval(timestampInterval);
    }
  });

  const assetRate = (() => {
    if (displayTxReceipt && path(['asset'], displayTxReceipt)) {
      return getAssetRate(displayTxReceipt.asset);
    } else {
      return getAssetRate(txConfig.asset);
    }
  })();

  const baseAssetRate = (() => {
    if (displayTxReceipt && path(['baseAsset'], displayTxReceipt)) {
      return getAssetRate(displayTxReceipt.baseAsset);
    } else {
      return getAssetRate(txConfig.baseAsset);
    }
  })();

  const handleTxSpeedUpRedirect = async () => {
    if (!txConfig) return;
    const { fast } = await fetchGasPriceEstimates(txConfig.network);
    const query = constructSpeedUpTxQuery(txConfig, calculateReplacementGasPrice(txConfig, fast));
    history.replace(`${ROUTE_PATHS.SEND.path}/?${query}`);
  };

  const handleTxCancelRedirect = async () => {
    if (!txConfig) return;
    const { fast } = await fetchGasPriceEstimates(txConfig.network);
    const query = constructCancelTxQuery(txConfig, calculateReplacementGasPrice(txConfig, fast));
    history.replace(`${ROUTE_PATHS.SEND.path}/?${query}`);
  };

  const sender = constructSenderFromTxConfig(txConfig, accounts);

  const senderContact = getContactByAddressAndNetworkId(sender.address, txConfig.network.id);

  const recipientContact = getContactByAddressAndNetworkId(
    txConfig.receiverAddress,
    txConfig.network.id
  );

  const txType = displayTxReceipt ? displayTxReceipt.txType : ITxType.STANDARD;

  const fiat = getFiat(settings);

  return (
    <TxReceiptUI
      settings={settings}
      txStatus={txStatus}
      timestamp={timestamp}
      senderContact={senderContact}
      sender={sender}
      recipientContact={recipientContact}
      displayTxReceipt={displayTxReceipt}
      protectTxEnabled={ptxState && ptxState.enabled}
      fiat={fiat}
      txConfig={txConfig}
      txReceipt={txReceipt}
      zapSelected={zapSelected}
      membershipSelected={membershipSelected}
      swapDisplay={swapDisplay}
      completeButtonText={completeButtonText}
      txQueryType={txQueryType}
      setDisplayTxReceipt={setDisplayTxReceipt}
      resetFlow={resetFlow}
      protectTxButton={protectTxButton}
      assetRate={assetRate}
      baseAssetRate={baseAssetRate}
      handleTxCancelRedirect={handleTxCancelRedirect}
      handleTxSpeedUpRedirect={handleTxSpeedUpRedirect}
      txType={txType}
    />
  );
};

export interface TxReceiptDataProps {
  settings: ISettings;
  txStatus: ITxStatus;
  timestamp: number;
  displayTxReceipt?: ITxReceipt;
  setDisplayTxReceipt?: Dispatch<SetStateAction<ITxReceipt | undefined>>;
  senderContact: ExtendedContact | undefined;
  sender: ISender;
  recipientContact: ExtendedContact | undefined;
  fiat: Fiat;
  swapDisplay?: SwapDisplayData;
  protectTxEnabled?: boolean;
  assetRate: number | undefined;
  baseAssetRate: number | undefined;
  handleTxCancelRedirect(): void;
  handleTxSpeedUpRedirect(): void;
  resetFlow(): void;
  protectTxButton?(): JSX.Element;
}

type UIProps = Omit<IStepComponentProps, 'resetFlow' | 'onComplete'> & TxReceiptDataProps;

export const TxReceiptUI = ({
  settings,
  txType,
  swapDisplay,
  txConfig,
  txStatus,
  timestamp,
  assetRate,
  displayTxReceipt,
  setDisplayTxReceipt,
  zapSelected,
  membershipSelected,
  senderContact,
  sender,
  baseAssetRate,
  fiat,
  recipientContact,
  resetFlow,
  completeButtonText,
  txQueryType,
  handleTxCancelRedirect,
  handleTxSpeedUpRedirect,
  protectTxEnabled = false,
  protectTxButton
}: UIProps) => {
  /* Determining User's Contact */
  const { asset, gasPrice, gasLimit, data, nonce, baseAsset, receiverAddress } = txConfig;

  const walletConfig = getWalletConfig(sender.account ? sender.account.wallet : WalletId.VIEW_ONLY);
  const web3Wallet = isWeb3Wallet(walletConfig.id);
  const supportsResubmit = walletConfig.flags.supportsNonce;

  const localTimestamp = new Date(Math.floor(timestamp * 1000)).toLocaleString();
  const assetAmount = useCallback(() => {
    if (displayTxReceipt && path(['amount'], displayTxReceipt)) {
      return displayTxReceipt.amount;
    } else {
      return txConfig.amount;
    }
  }, [displayTxReceipt, txConfig.amount]);

  const assetTicker = useCallback(() => {
    if (displayTxReceipt && path(['asset'], displayTxReceipt)) {
      return displayTxReceipt.asset.ticker;
    } else {
      return txConfig.asset.ticker;
    }
  }, [displayTxReceipt, txConfig.asset]);

  return (
    <div className="TransactionReceipt">
      {protectTxEnabled && !web3Wallet && (
        <ProtectTxAbort
          onTxSent={(txReceipt) => {
            if (setDisplayTxReceipt) {
              setDisplayTxReceipt(txReceipt);
            }
          }}
        />
      )}
      {txStatus === ITxStatus.PENDING && txType !== ITxType.FAUCET && (
        <div className="TransactionReceipt-row">
          <div className="TransactionReceipt-row-desc">
            {protectTxEnabled && !web3Wallet && <SSpacer />}
            {translate('TRANSACTION_BROADCASTED_DESC')}
          </div>
        </div>
      )}
      {txType === ITxType.FAUCET && (
        <div className="TransactionReceipt-row">
          <div className="TransactionReceipt-row-desc">{translate('FAUCET_SUCCESS')}</div>
        </div>
      )}
      {txType === ITxType.SWAP && swapDisplay && (
        <div className="TransactionReceipt-row">
          <SwapFromToDiagram
            fromSymbol={swapDisplay.fromAsset.ticker}
            toSymbol={swapDisplay.toAsset.ticker}
            fromAmount={swapDisplay.fromAmount.toString()}
            toAmount={swapDisplay.toAmount.toString()}
            fromUUID={swapDisplay.fromAsset.uuid}
            toUUID={swapDisplay.toAsset.uuid}
          />
        </div>
      )}
      {txType === ITxType.PURCHASE_MEMBERSHIP && membershipSelected && (
        <div className="TransactionReceipt-row">
          <MembershipReceiptBanner membershipSelected={membershipSelected} />
        </div>
      )}
      {txType !== ITxType.PURCHASE_MEMBERSHIP && txType !== ITxType.FAUCET && (
        <>
          <FromToAccount
            networkId={sender.network.id}
            fromAccount={{
              address: (sender.address || (displayTxReceipt && displayTxReceipt.from)) as TAddress,
              addressBookEntry: senderContact
            }}
            toAccount={{
              address: (receiverAddress || (displayTxReceipt && displayTxReceipt.to)) as TAddress,
              addressBookEntry: recipientContact
            }}
            displayToAddress={txType !== ITxType.DEPLOY_CONTRACT}
          />
        </>
      )}
      {txType === ITxType.FAUCET && (
        <>
          <FromToAccount
            from={{
              address: FAUCET_ADDRESS as TAddress,
              label: 'MyCrypto Faucet'
            }}
            to={{
              address: (receiverAddress || (displayTxReceipt && displayTxReceipt.to)) as TAddress,
              label: recipientLabel
            }}
          />
        </>
      )}
      {txType === ITxType.PURCHASE_MEMBERSHIP && membershipSelected && (
        <div className="TransactionReceipt-row">
          <TxIntermediaryDisplay
            address={membershipSelected.contractAddress}
            contractName={asset.ticker}
          />
        </div>
      )}
      {txType === ITxType.DEFIZAP && zapSelected && (
        <>
          <div className="TransactionReceipt-row">
            <TxIntermediaryDisplay
              address={zapSelected.contractAddress}
              contractName={'DeFi Zap'}
            />
          </div>
          <div className="TransactionReceipt-row">
            <div className="TransactionReceipt-row-column">
              <SImg src={zapperLogo} size="24px" />
              {translateRaw('ZAP_NAME')}
            </div>
            <div className="TransactionReceipt-row-column rightAligned">{zapSelected.title}</div>
          </div>
          <div className="TransactionReceipt-row">
            <div className="TransactionReceipt-row-column">{translateRaw('PLATFORMS')}</div>
            <div className="TransactionReceipt-row-column rightAligned">
              <ProtocolTagsList platformsUsed={zapSelected.platformsUsed} />
            </div>
          </div>
          <div className="TransactionReceipt-divider" />
        </>
      )}

      {txType !== ITxType.SWAP && txType !== ITxType.FAUCET && (
        <div className="TransactionReceipt-row">
          <div className="TransactionReceipt-row-column">
            {txType === ITxType.FAUCET ? (
              <>
                <img src={receiveIcon} alt="Received" />
                {translate('CONFIRM_TX_RECEIVED')}
              </>
            ) : (
              <>
                <img src={sentIcon} alt="Sent" />
                {translate('CONFIRM_TX_SENT')}
              </>
            )}
          </div>
          <div className="TransactionReceipt-row-column rightAligned">
            <AssetIcon uuid={asset.uuid} size={'24px'} />
            <Amount
              assetValue={`${parseFloat(assetAmount()).toFixed(6)} ${assetTicker()}`}
              fiat={{
                symbol: getFiat(settings).symbol,
                ticker: getFiat(settings).ticker,
                amount: convertToFiat(parseFloat(assetAmount()), assetRate).toFixed(2)
              }}
            />
          </div>
        </div>
      )}
      {txType !== ITxType.DEFIZAP && txType !== ITxType.FAUCET && (
        <div className="TransactionReceipt-divider" />
      )}
      <div className="TransactionReceipt-details">
        {txType === ITxType.FAUCET && (
          <>
            <div className="TransactionReceipt-details-row">
              <div className="TransactionReceipt-details-row-column">{translate('X_AMOUNT')}:</div>
              <div className="TransactionReceipt-details-row-column">
                {parseFloat(assetAmount()).toFixed(1)} ETH
              </div>
            </div>
            <div className="TransactionReceipt-details-row">
              <div className="TransactionReceipt-details-row-column">{translate('X_NETWORK')}:</div>
              <div className="TransactionReceipt-details-row-column">{txConfig.network.name}</div>
            </div>
            <div className="TransactionReceipt-divider" />
          </>
        )}
        <div className="TransactionReceipt-details-row">
          <div className="TransactionReceipt-details-row-column">
            {translate('TRANSACTION_ID')}:
          </div>
          <div className="TransactionReceipt-details-row-column">
            {displayTxReceipt && txConfig.network && txConfig.network.blockExplorer && (
              <LinkOut
                text={displayTxReceipt.hash}
                truncate={truncate}
                link={txConfig.network.blockExplorer.txUrl(displayTxReceipt.hash)}
              />
            )}
            {!displayTxReceipt && <PendingTransaction />}
          </div>
        </div>

        <div className="TransactionReceipt-details-row">
          <div className="TransactionReceipt-details-row-column">
            {translate('TRANSACTION_STATUS')}:
          </div>
          <div className="TransactionReceipt-details-row-column">
            {displayTxReceipt && translate(txStatus)}
            {!displayTxReceipt && <PendingTransaction />}
          </div>
        </div>

        <div className="TransactionReceipt-details-row">
          <div className="TransactionReceipt-details-row-column">{translate('TIMESTAMP')}:</div>
          <div className="TransactionReceipt-details-row-column">
            {displayTxReceipt &&
              (timestamp !== 0 ? (
                <div>
                  {<TimeElapsed value={timestamp} />}
                  <br /> {localTimestamp}
                </div>
              ) : (
                translate('UNKNOWN')
              ))}
            {!displayTxReceipt && <PendingTransaction />}
          </div>
        </div>

        {protectTxButton && protectTxButton()}

        {txType !== ITxType.FAUCET && (
          <TransactionDetailsDisplay
            baseAsset={baseAsset}
            asset={asset}
            confirmations={displayTxReceipt && displayTxReceipt.confirmations}
            gasUsed={displayTxReceipt && displayTxReceipt.gasUsed}
            data={data}
            sender={sender}
            gasLimit={gasLimit}
            gasPrice={gasPrice}
            nonce={nonce}
            rawTransaction={txConfig.rawTransaction}
            fiat={fiat}
            baseAssetRate={baseAssetRate}
          />
        )}
      </div>
      {txType === ITxType.FAUCET && (
        <NewTabLink
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
            translateRaw('FAUCET_TWEET', {
              /* TODO: How to find base url without hardcoding? */
              $faucet_url: 'https://app.mycrypto.com' + ROUTE_PATHS.FAUCET.path
            })
          )}`}
        >
          <Button inverted={true} fullwidth={true} className="TransactionReceipt-tweet">
            <i className="sm-icon sm-logo-twitter TransactionReceipt-tweet-icon" />{' '}
            <span className="TransactionReceipt-tweet-text">{translate('FAUCET_SHARE')}</span>
          </Button>
        </NewTabLink>
      )}
      {completeButtonText && !(txStatus === ITxStatus.PENDING) && (
        <Button secondary={true} className="TransactionReceipt-another" onClick={resetFlow}>
          {completeButtonText}
        </Button>
      )}
      {txStatus === ITxStatus.PENDING && txQueryType !== TxQueryTypes.SPEEDUP && txType !== ITxType.FAUCET && txConfig && (
        <Tooltip display="block" tooltip={translateRaw('SPEED_UP_TOOLTIP')}>
          <Button
            className="TransactionReceipt-another"
            onClick={handleTxSpeedUpRedirect}
            disabled={!supportsResubmit}
          >
            {translateRaw('SPEED_UP_TX_BTN')}
          </Button>
        </Tooltip>
      )}
      {txStatus === ITxStatus.PENDING && txQueryType !== TxQueryTypes.CANCEL && txType !== ITxType.FAUCET && txConfig && (
        <Tooltip display="block" tooltip={translateRaw('SPEED_UP_TOOLTIP')}>
          <Button
            className="TransactionReceipt-another"
            onClick={handleTxCancelRedirect}
            disabled={!supportsResubmit}
          >
            {translateRaw('CANCEL_TX_BTN')}
          </Button>
        </Tooltip>
      )}
      {txType === ITxType.FAUCET ? (
        <Link to={ROUTE_PATHS.DASHBOARD.path}>
          <Button secondary={true} className="TransactionReceipt-back">
            {translate('FAUCET_CLOSE')}
          </Button>
        </Link>
      ) : (
        <Link to={ROUTE_PATHS.DASHBOARD.path}>
          <Button className="TransactionReceipt-back">
            {translate('TRANSACTION_BROADCASTED_BACK_TO_DASHBOARD')}
          </Button>
        </Link>
      )}
      {txType === ITxType.DEFIZAP && <PoweredByText provider="ZAPPER" />}
    </div>
  );
};

export default withRouter(TxReceipt);
