import React, { PureComponent } from 'react'
import { connect, ConnectedProps } from 'react-redux'
import { find, isEmpty, pathOr, propEq, propOr } from 'ramda'
import { bindActionCreators } from 'redux'

import { Remote } from '@core'
import { CrossBorderLimitsPyload, OrderType, SBPaymentTypes, WalletAcountEnum } from '@core/types'
import { FlyoutOopsError } from 'components/Flyout'
import { actions, selectors } from 'data'
import { getValidPaymentMethod } from 'data/components/simpleBuy/model'
import { RootState } from 'data/rootReducer'
import { RecurringBuyPeriods, SBCheckoutFormValuesType, UserDataType } from 'data/types'

import Loading from '../../template.loading'
import {
  OwnProps as EnterAmountOwnProps,
  SuccessStateType as EnterAmountSuccessStateType
} from '../index'
import getData from './selectors'
import Success from './template.success'

class Checkout extends PureComponent<Props> {
  componentDidMount() {
    const dataGoal = find(propEq('name', 'simpleBuy'), this.props.goals)
    const goalAmount = pathOr('', ['data', 'amount'], dataGoal)
    const amount = goalAmount || this.props.formValues?.amount || '0'
    const cryptoAmount = this.props.formValues?.cryptoAmount
    const period = this.props.formValues?.period || RecurringBuyPeriods.ONE_TIME
    this.errorCallback = this.errorCallback.bind(this)
    this.props.buySellActions.initializeCheckout({
      account: this.props.swapAccount,
      amount,
      cryptoAmount,
      fix: this.props.preferences[this.props.orderType].fix,
      orderType: this.props.orderType,
      pair: this.props.pair,
      pairs: this.props.pairs,
      period
    })

    // If no method was given but we have a default method, set it in redux
    // and the rest of the SB flow works much better
    if (!this.props.method && this.props.defaultMethod) {
      this.props.buySellActions.setMethod(this.props.defaultMethod)
    }

    if (!Remote.Success.is(this.props.data)) {
      this.props.buySellActions.fetchSDDEligibility()
      this.props.buySellActions.fetchCards(false)
      this.props.brokerageActions.fetchBankTransferAccounts()
      this.props.recurringBuyActions.fetchPaymentInfo()
    }
    // we fetch limits as part of home banners logic at that point we had only fiatCurrency
    // here we have to re-fetch for crypto currency and order type
    this.props.buySellActions.fetchLimits({
      cryptoCurrency: this.props.cryptoCurrency,
      currency: this.props.fiatCurrency,
      side: this.props.orderType || OrderType.BUY
    })

    // fetch crossborder limits
    this.props.buySellActions.fetchCrossBorderLimits({
      fromAccount:
        this.props.orderType === OrderType.BUY
          ? WalletAcountEnum.CUSTODIAL
          : this.props.swapAccount?.type || WalletAcountEnum.CUSTODIAL,
      inputCurrency:
        this.props.orderType === OrderType.BUY
          ? this.props.fiatCurrency
          : this.props.cryptoCurrency,
      outputCurrency:
        this.props.orderType === OrderType.BUY
          ? this.props.cryptoCurrency
          : this.props.fiatCurrency,
      toAccount: WalletAcountEnum.CUSTODIAL
    } as CrossBorderLimitsPyload)
  }

  componentDidUpdate(prevProps) {
    const prevId = prevProps.defaultMethod?.id
    const currId = this.props.defaultMethod?.id

    // check to see if there was no default method and now there is, then fire analytics event
    // we only really want this analytics event to trigger when the user opens the buy modal and
    // a default payment method is automatically used
    if (this.props.defaultMethod && currId && prevId !== currId) {
      this.props.buySellActions.defaultMethodEvent(this.props.defaultMethod)
    }
  }

  handleSubmit = () => {
    // if the user is < tier 2 go to kyc but save order info
    // if the user is tier 2 try to submit order, let BE fail
    const { formValues } = this.props
    const { hasPaymentAccount, isSddFlow, userData } = this.props.data.getOrElse({
      hasPaymentAccount: false,
      isSddFlow: false,
      userData: { tiers: { current: 0, next: 0, selected: 0 } } as UserDataType
    } as SuccessStateType)
    const simpleBuyGoal = find(propEq('name', 'simpleBuy'), this.props.goals)

    const id = propOr('', 'id', simpleBuyGoal)

    if (!isEmpty(id)) {
      this.props.deleteGoal(String(id))
    }

    const method = this.props.method || this.props.defaultMethod

    // TODO: sell
    // need to do kyc check
    // SELL
    if (formValues?.orderType === OrderType.SELL) {
      return this.props.buySellActions.setStep({
        sellOrderType: this.props.swapAccount?.type,
        step: 'PREVIEW_SELL'
      })
    }

    // BUY
    if (isSddFlow) {
      const currentTier = userData?.tiers?.current
      if (currentTier === 2 || currentTier === 1) {
        // user in SDD but already completed eligibility check, continue to payment
        this.props.buySellActions.createOrder({ paymentType: SBPaymentTypes.PAYMENT_CARD })
      } else {
        // user in SDD but needs to confirm KYC and SDD eligibility
        this.props.identityVerificationActions.verifyIdentity({
          checkSddEligibility: true,
          needMoreInfo: false,
          onCompletionCallback: () =>
            this.props.buySellActions.createOrder({ paymentType: SBPaymentTypes.PAYMENT_CARD }),
          origin: 'SimpleBuy',
          tier: 2
        })
      }
    } else if (!method) {
      const { fiatCurrency } = this.props
      const nextStep = hasPaymentAccount ? 'LINKED_PAYMENT_ACCOUNTS' : 'PAYMENT_METHODS'
      this.props.buySellActions.setStep({
        cryptoCurrency: this.props.cryptoCurrency,
        fiatCurrency,
        order: this.props.order,
        pair: this.props.pair,
        step: nextStep
      })
    } else if (userData.tiers.current < 2) {
      this.props.buySellActions.createOrder({ paymentMethodId: getValidPaymentMethod(method.type) })
    } else if (formValues && method) {
      switch (method.type) {
        case SBPaymentTypes.PAYMENT_CARD:
          this.props.buySellActions.setStep({
            step: 'ADD_CARD'
          })
          break
        case SBPaymentTypes.USER_CARD:
          this.props.buySellActions.createOrder({
            paymentMethodId: method.id,
            paymentType: SBPaymentTypes.PAYMENT_CARD
          })
          break
        case SBPaymentTypes.FUNDS:
          this.props.buySellActions.createOrder({ paymentType: SBPaymentTypes.FUNDS })
          break
        case SBPaymentTypes.BANK_TRANSFER:
          this.props.buySellActions.createOrder({
            paymentMethodId: method.id,
            paymentType: SBPaymentTypes.BANK_TRANSFER
          })
          break
        case SBPaymentTypes.BANK_ACCOUNT:
          break
        default:
          break
      }
    }
  }

  errorCallback() {
    this.props.buySellActions.setStep({
      fiatCurrency: this.props.fiatCurrency || 'USD',
      step: 'CRYPTO_SELECTION'
    })
  }

  render() {
    return this.props.data.cata({
      Failure: () => (
        <FlyoutOopsError
          action='retry'
          data-e2e='sbTryCurrencySelectionAgain'
          handler={this.errorCallback}
        />
      ),
      Loading: () => <Loading />,
      NotAsked: () => <Loading />,
      Success: (val) => <Success {...this.props} {...val} onSubmit={this.handleSubmit} />
    })
  }
}

const mapStateToProps = (state: RootState, ownProps: OwnProps) => ({
  cryptoCurrency: selectors.components.simpleBuy.getCryptoCurrency(state) || 'BTC',
  data: getData(state, ownProps),
  fiatCurrency: selectors.components.simpleBuy.getFiatCurrency(state) || 'USD',
  formValues: selectors.form.getFormValues('simpleBuyCheckout')(state) as
    | SBCheckoutFormValuesType
    | undefined,
  goals: selectors.goals.getGoals(state),
  isPristine: selectors.form.isPristine('simpleBuyCheckout')(state),
  preferences: selectors.preferences.getSBCheckoutPreferences(state),
  sbOrders: selectors.components.simpleBuy.getSBOrders(state).getOrElse([])
})

const mapDispatchToProps = (dispatch) => ({
  brokerageActions: bindActionCreators(actions.components.brokerage, dispatch),
  buySellActions: bindActionCreators(actions.components.buySell, dispatch),
  deleteGoal: (id: string) => dispatch(actions.goals.deleteGoal(id)),
  identityVerificationActions: bindActionCreators(
    actions.components.identityVerification,
    dispatch
  ),
  profileActions: bindActionCreators(actions.modules.profile, dispatch),
  recurringBuyActions: bindActionCreators(actions.components.recurringBuy, dispatch)
})

const connector = connect(mapStateToProps, mapDispatchToProps)

export type OwnProps = EnterAmountOwnProps & EnterAmountSuccessStateType
export type SuccessStateType = ReturnType<typeof getData>['data'] & {
  formErrors: { amount?: 'ABOVE_MAX' | 'BELOW_MIN' | boolean }
  hasPaymentAccount: boolean
}
export type Props = OwnProps & ConnectedProps<typeof connector>

export default connector(Checkout)
