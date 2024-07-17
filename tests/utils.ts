const memoized: Map<number, number> = new Map();

function roundToXDecimals(val: number, x: number) {
    let amplifier: number;
    if (memoized.has(x))
        amplifier = memoized.get(x)!;
    else
        amplifier = Math.pow(10, x);
    return Math.round(val * amplifier) / amplifier;
}

export function roundToTwoDecimals(val: number) {
    return roundToXDecimals(val, 2);
}

export function roundToThreeDecimals(val: number) {
    return roundToXDecimals(val, 3);
}

export function roundToSixDecimals(val: number) {
    return roundToXDecimals(val, 6);
}