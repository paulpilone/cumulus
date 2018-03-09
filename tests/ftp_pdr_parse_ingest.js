'use strict';

const path = require('path');
const test = require('ava');
const fs = require('fs-extra');
const { fetchMessageAdapter } = require('../packages/deployment/lib/adapter');
const {
  runWorkflow,
  copyCMAToTasks,
  deleteCMAFromTasks,
  messageBuilder
} = require('../packages/integration-tests/local');
const { randomString, createQueue } = require('../packages/common/test-utils');
const { recursivelyDeleteS3Bucket, s3, sqs } = require('../packages/common/aws');
const workflowSet = require('./fixtures/workflows/ftp_pdr_parse_ingest.json');
const collections = require('./fixtures/collections.json');
const providers = require('./fixtures/providers.json');

// unfortunately t.context is not available in test.before
// this is fixed in ava 1.0.0 but it has a lot of breaking
// changes. The global variables below help with passing messages
// around between before and after hooks.
const context = {};
const cmaFolder = 'cumulus-message-adapter';


test.before(async() => {
  context.internal = randomString();
  context.stack = randomString();
  context.templates = {};
  await s3().createBucket({ Bucket: context.internal }).promise();

  // download and unzip the message adapter
  const gitPath = 'cumulus-nasa/cumulus-message-adapter';
  const filename = 'cumulus-message-adapter.zip';
  context.src = path.join(process.cwd(), 'tests', 'adapter.zip');
  context.dest = path.join(process.cwd(), 'tests', cmaFolder); 
  await fetchMessageAdapter(null, gitPath, filename, context.src, context.dest);

  // create the queue
  context.queueUrl = await createQueue();

  const config = {
    buckets: {
      internal: context.internal
    },
    stack: context.stack,
    stepFunctions: {},
    sqs: {}
  };

  const cfOutputs = [{
    OutputKey: 'startSFSQSOutput',
    OutputValue: context.queueUrl
  }];

  // create workflow templates
  Object.keys(workflowSet).forEach((w) => {
    config.stepFunctions[w] = {};
  });

  const promises = Object.keys(workflowSet).map((w) => {
    context.templates[w] = messageBuilder(workflowSet[w], config, cfOutputs);
    return s3().putObject({
      Bucket: context.internal,
      Key: `${context.stack}/workflows/${w}.json`,
      Body: JSON.stringify(context.templates[w])
    }).promise();
  });

  // upload templates
  await Promise.all(promises);
});

test.serial('DiscoverPdr Workflow with FTP provider', async (t) => {
  const workflow = workflowSet.DiscoverPdrs;
  const input = context.templates.DiscoverPdrs;
  try {
    // copy cumulus-message-adapter
    await copyCMAToTasks(workflow, context.dest, cmaFolder);

    input.meta.collection = collections[workflow.collection];
    input.meta.provider = providers[workflow.provider];
    const msg = await runWorkflow(workflow, input);

    // discover-pdr must return a list of PDRs
    const pdrs = msg.stepOutputs.DiscoverPdrs.payload.pdrs;
    t.true(Array.isArray(pdrs));
    t.is(pdrs.length, 4);

    t.is(msg.output.payload.pdrs_queued, pdrs.length);
  }
  finally {
    // remove cumulus-message-adapter from tasks
    await deleteCMAFromTasks(workflow, cmaFolder);
  }
});

test.after.always('final cleanup', async() => {
  await recursivelyDeleteS3Bucket(context.internal);
  await sqs().deleteQueue({ QueueUrl: context.queueUrl }).promise();
  await fs.remove(context.src);
  await fs.remove(context.dest);
});
