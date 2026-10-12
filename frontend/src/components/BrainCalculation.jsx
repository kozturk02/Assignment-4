import Calculation, { Equation } from './Calculation';
import { money, number } from '../format';

export default function BrainCalculation({ record, config, product }) {
  const d = record.details;
  const windowDays = Math.min(record.day, config.observationDays);
  const demandFraction = `${number(d.observedDailyDemand * windowDays)} ÷ ${windowDays}`;
  const cover = Math.min(config.targetDays, config.days - record.day,
    product.shelfLifeDays ? Math.max(1, product.shelfLifeDays - 1) : config.targetDays);
  return <>
    <Calculation>
      {d.observedDailyDemand !== undefined && <>
        <Equation label="Observed demand" formula="Average demand = requested units ÷ observation days (including missed units)"
          substitution={demandFraction}
          result={`${number(d.observedDailyDemand, 4)} units / day`} />
        <Equation label="Low-stock threshold" formula="Threshold = max(2, ⌈average demand × reorder days⌉)"
          substitution={`max(2, ⌈(${demandFraction}) × ${config.reorderDays}⌉)`}
          result={number(Math.max(2, Math.ceil(d.observedDailyDemand * config.reorderDays)))} />
        <Equation label="Replenishment target" formula="Target = ⌈average demand × min(target days, days remaining, shelf-life cap)⌉"
          substitution={`⌈(${demandFraction}) × min(${config.targetDays}, ${config.days - record.day}, ${product.shelfLifeDays ? Math.max(1, product.shelfLifeDays - 1) : config.targetDays})⌉`}
          result={number(Math.ceil(d.observedDailyDemand * cover))} />
      </>}
      {record.type === 'slow_mover' && <>
        <Equation label="Slow-mover threshold" formula="Threshold = max(10, average fulfilled sales × slow-mover cover)"
          substitution={`max(10, (${number(d.observedDailySales * windowDays)} ÷ ${windowDays}) × ${config.slowMoverCoverDays})`}
          result={number(Math.max(10, d.observedDailySales * config.slowMoverCoverDays), 4)} />
        <Equation label="Slow-mover test" formula="Day ≥ observation days and stock > slow-mover threshold"
          substitution={`${record.day} ≥ ${config.observationDays}; ${number(d.stock)} > ${number(Math.max(10, d.observedDailySales * config.slowMoverCoverDays), 4)}`} />
      </>}
      {record.type === 'replenishment' && <>
        <Equation label="Requested order" formula="Wanted = max(0, target − closing stock)"
          substitution={`max(0, ${d.targetQuantity} − ${d.stock})`} result={Math.max(0, d.targetQuantity - d.stock)} />
        <Equation label="Order cost" formula="Spending = ordered units × unit purchase cost"
          substitution={`${d.quantity} × ${money(product.unitCostCents)}`} result={money(d.costCents)} />
      </>}
      {record.type === 'cash_constraint' && <Equation label="Cash-limited order" formula="Ordered = min(wanted, ⌊available cash ÷ unit purchase cost⌋)"
        substitution={`min(${d.wantedQuantity}, ⌊${money(d.cashBeforeCents)} ÷ ${money(product.unitCostCents)}⌋)`}
        result={`${d.orderedQuantity} units; ${d.unfilledQuantity} unfilled`} />}
      {record.type === 'expiry' && <Equation label="Write-off" formula="Write-off value = expired units × unit purchase cost"
        substitution={`${d.quantity} × ${money(product.unitCostCents)}`} result={money(d.writeOffCents)} />}
      {record.type === 'expiry_warning' && <Equation label="Expiry warning" formula="Earliest expiry day ≤ current day + warning days"
        substitution={`${d.earliestExpiryDay} ≤ ${record.day} + ${config.expiryWarningDays} (${record.day + config.expiryWarningDays})`} />}
    </Calculation>
    <details><summary>Stored record</summary><pre className="record-json">{JSON.stringify(d, null, 2)}</pre></details>
  </>;
}
