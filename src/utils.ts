
// groupBy from https://stackoverflow.com/a/62765924
export const groupBy = <T, K extends keyof T | string>(arr: T[], key: (i: T) => K) =>
    arr.reduce((groups, item) => {
        (groups[key(item)] ||= []).push(item);
        return groups;
    }, {} as Record<K, T[]>);

export const delay = async (ms: number) => new Promise( resolve => setTimeout(resolve, ms) );