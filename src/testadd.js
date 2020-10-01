import buildThreadManager from "./threadman.js";
import {getCurveFromName} from "ffjavascript";


async function run() {
    const curve = await getCurveFromName("bn128", false);
    const tm = await buildThreadManager(curve, true);

    const N= 100;
    const M= 1000000;
    const ops = [];

    const two = curve.Fr.add(curve.Fr.one, curve.Fr.one);

    for (let i=0; i<N; i++) {
        ops.push(tm.queueAction([two, M]));
        await tm.yield();
    }

    const subRes = await Promise.all(ops);

    const res = await tm.queueAction(subRes);

    await tm.terminate();

    console.log("Resilt: ", curve.Fr.toString(res));
}

run().then( (res) => {
    process.exit(res);
}, (err) => {
    console.log(err);
    process.exit(1);
});
