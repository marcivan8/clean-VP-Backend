const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

async function test() {
    const lambdaClient = new LambdaClient({ region: 'eu-north-1' });
    try {
        const command = new InvokeCommand({
            FunctionName: 'revideo-render-lambda',
            InvocationType: 'Event',
            Payload: Buffer.from(JSON.stringify({ test: true })),
        });
        await lambdaClient.send(command);
        console.log("Success");
    } catch (e) {
        console.error("Error:", e);
    }
}
test();
