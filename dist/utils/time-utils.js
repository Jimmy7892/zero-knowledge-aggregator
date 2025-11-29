"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeUtils = void 0;
class TimeUtils {
    static truncateToHour(date) {
        const truncated = new Date(date);
        truncated.setMinutes(0, 0, 0);
        return truncated;
    }
    static formatHour(date) {
        return this.truncateToHour(date).toISOString();
    }
    static parseHour(hourString) {
        const date = new Date(hourString);
        return this.truncateToHour(date);
    }
    static generateHourRange(startHour, endHour) {
        const hours = [];
        const current = this.truncateToHour(startHour);
        const end = this.truncateToHour(endHour);
        while (current <= end) {
            hours.push(new Date(current));
            current.setHours(current.getHours() + 1);
        }
        return hours;
    }
    static getPeriodStart(date, aggregation) {
        const result = new Date(date);
        switch (aggregation) {
            case 'hourly':
                return this.truncateToHour(result);
            case 'daily':
                result.setHours(0, 0, 0, 0);
                return result;
            case 'weekly': {
                const day = result.getDay();
                const diff = result.getDate() - day + (day === 0 ? -6 : 1);
                result.setDate(diff);
                result.setHours(0, 0, 0, 0);
                return result;
            }
            case 'monthly':
                result.setDate(1);
                result.setHours(0, 0, 0, 0);
                return result;
            default:
                return this.truncateToHour(result);
        }
    }
    static getPeriodEnd(date, aggregation) {
        const result = new Date(date);
        switch (aggregation) {
            case 'hourly': {
                const hourEnd = this.truncateToHour(result);
                hourEnd.setHours(hourEnd.getHours() + 1);
                hourEnd.setMilliseconds(-1);
                return hourEnd;
            }
            case 'daily':
                result.setHours(23, 59, 59, 999);
                return result;
            case 'weekly': {
                const startOfWeek = this.getPeriodStart(date, 'weekly');
                const endOfWeek = new Date(startOfWeek);
                endOfWeek.setDate(endOfWeek.getDate() + 6);
                endOfWeek.setHours(23, 59, 59, 999);
                return endOfWeek;
            }
            case 'monthly':
                result.setMonth(result.getMonth() + 1, 0);
                result.setHours(23, 59, 59, 999);
                return result;
            default: {
                const defaultEnd = this.truncateToHour(result);
                defaultEnd.setHours(defaultEnd.getHours() + 1);
                defaultEnd.setMilliseconds(-1);
                return defaultEnd;
            }
        }
    }
    static isInHour(date, hour) {
        const truncatedDate = this.truncateToHour(date);
        const truncatedHour = this.truncateToHour(hour);
        return truncatedDate.getTime() === truncatedHour.getTime();
    }
    static getStartOfDayUTC(date = new Date()) {
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
    }
}
exports.TimeUtils = TimeUtils;
//# sourceMappingURL=time-utils.js.map