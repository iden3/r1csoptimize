import {readR1cs, writeR1cs}  from "r1csfile";
import Logger from "logplease";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import optimizer from "./src/optimizer.js";


const argv = yargs(hideBin(process.argv)).argv;

console.log(argv);

const logger = Logger.create("snarkJS", {showTimestamp:false});

async function run(r1csNameFrom, r1csNameTo, logger) {
    const cir = await readR1cs(r1csNameFrom, true, true, logger, "");

    const newCir = await optimizer(cir, logger);

    await writeR1cs(r1csNameTo, newCir, logger, "");

    return 0;
}

run(argv._[0], argv._[1], logger).then( (res) => {
    process.exit(res);
}, (err) => {
    logger.error(err);
    process.exit(1);
});
