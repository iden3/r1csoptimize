import {readR1cs}  from "r1csfile";
import {readExisting, createOverride} from "fastfile";
import {BigBuffer} from "ffjavascript";
import Logger from "logplease";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";


const argv = yargs(hideBin(process.argv)).argv;

console.log(argv);

const logger = Logger.create("snarkJS", {showTimestamp:false});

async function remap(r1csNameFrom, datFrom, datTo, logger) {
    const cir = await readR1cs(r1csNameFrom, false, true, true, logger, "");

    const fdDatFrom = await readExisting(datFrom,1<<25, 1<<22);
    const pWit2Sig = await fdDatFrom.readULE64();

    const copyBuff = new BigBuffer(pWit2Sig);

    await fdDatFrom.readToBuffer(copyBuff, 0, pWit2Sig, 0);
    await fdDatFrom.close();

    const fdDatTo = await createOverride(datTo,1<<25, 1<<22);

    await fdDatTo.write(copyBuff);

    const newSig2Wit = new Uint8Array(4*cir.nVars);
    const newSig2WitV = new DataView(newSig2Wit.buffer);

    for (let i=0; i<cir.nVars; i++) {
        newSig2WitV.setUint32(i*4, cir.map[i], true);
    }

    await fdDatTo.write(newSig2Wit);

    await fdDatTo.writeULE32(64, cir.nVars);

    await fdDatTo.close();

    return 0;
}

remap(argv._[0], argv._[1], argv._[2], logger).then( (res) => {
    process.exit(res);
}, (err) => {
    logger.error(err);
    process.exit(1);
});
