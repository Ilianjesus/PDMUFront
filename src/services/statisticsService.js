import { getOperationalStatisticsSupabase } from "./supabaseBusiness/statisticsRepository";

export function getOperationalStatistics(filters) {
  return getOperationalStatisticsSupabase(filters);
}
