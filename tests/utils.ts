const memoized: Map<number, number> = new Map();

export function roundToXDecimals(val: number, x: number): number {
    let amplifier: number;
    if (memoized.has(x))
        amplifier = memoized.get(x)!;
    else
        amplifier = Math.pow(10, x);
    return Math.round(val * amplifier) / amplifier;
}

export function roundToTwoDecimals(val: number): number {
    return roundToXDecimals(val, 2);
}

export function roundToThreeDecimals(val: number): number {
    return roundToXDecimals(val, 3);
}