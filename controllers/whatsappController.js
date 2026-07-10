const asyncHandler = require('express-async-handler');
const WhatsAppLog = require('../models/WhatsAppLog');
const Customer = require('../models/Customer');

const {
  sendWhatsAppText,
  sendWhatsAppTemplate
} = require('../utils/sendWhatsApp');



const scopeToRole = (req, filter = {}) => {

  if (req.user.role === 'telecaller') {

    filter.sentBy = req.user._id;

  }

  return filter;

};



// ----------------------------------------------------
// Send WhatsApp Message
// Testing with Meta hello_world template
// ----------------------------------------------------

const sendMessage = asyncHandler(async (req, res) => {


  const { customerId, type = 'follow-up' } = req.body;



  const customer = await Customer.findById(customerId);



  if (!customer) {

    res.status(404);

    throw new Error('Customer not found');

  }




  if (!customer.mobile) {

    res.status(400);

    throw new Error(
      'This customer has no mobile number on file'
    );

  }




  // Meta default template

  const result = await sendWhatsAppTemplate({

    to: customer.mobile,

    templateName: "hello_world",

    languageCode: "en_US",

    params: []

  });





  const log = await WhatsAppLog.create({

    customerId,

    customerName: customer.name,

    phone: customer.mobile,

    message: "hello_world template",

    type,

    status: result.success
      ? "sent"
      : "failed",

    sentBy: req.user._id,

    sentByName: req.user.name,

    providerMessageId:
      result.providerMessageId || ""

  });





  if (!result.success) {


    return res.status(502).json({


      success:false,


      message:
      `WhatsApp send failed: ${result.error}`,


      log


    });


  }





  res.status(201).json({


    success:true,


    log


  });



});







// ----------------------------------------------------
// Send Custom Template
// ----------------------------------------------------


const sendTemplate = asyncHandler(async (req,res)=>{


const {

customerId,

templateName,

languageCode,

params,

type="template",

displayMessage


}=req.body;




const customer =
await Customer.findById(customerId);




if(!customer){


res.status(404);

throw new Error("Customer not found");


}




const result = await sendWhatsAppTemplate({


to:customer.mobile,


templateName,


languageCode,


params


});






const log = await WhatsAppLog.create({



customerId,


customerName:customer.name,


phone:customer.mobile,


message:
displayMessage || `[Template: ${templateName}]`,


type,


status:
result.success ? "sent" : "failed",



sentBy:req.user._id,


sentByName:req.user.name,



providerMessageId:
result.providerMessageId || ""



});






if(!result.success){



return res.status(502).json({



success:false,



message:
`WhatsApp send failed: ${result.error}`,



log



});



}






res.status(201).json({


success:true,


log


});



});








// ----------------------------------------------------
// Follow Up Reminder
// ----------------------------------------------------



const sendFollowUpReminder = asyncHandler(async(req,res)=>{



const {customerId}=req.body;



const customer =
await Customer.findById(customerId);




if(!customer){


res.status(404);

throw new Error("Customer not found");


}





const result =
await sendWhatsAppTemplate({



to:customer.mobile,



templateName:"hello_world",



languageCode:"en_US",



params:[]



});





const log =
await WhatsAppLog.create({



customerId,



customerName:customer.name,



phone:customer.mobile,



message:"hello_world followup",



type:"follow-up",



status:
result.success ? "sent":"failed",



sentBy:req.user._id,



sentByName:req.user.name,



providerMessageId:
result.providerMessageId || ""



});






if(!result.success){



return res.status(502).json({



success:false,



message:
`WhatsApp send failed: ${result.error}`,



log



});



}




res.status(201).json({


success:true,


log


});



});









// ----------------------------------------------------
// Get WhatsApp Logs
// ----------------------------------------------------


const getLogs = asyncHandler(async(req,res)=>{


const {

type,

status,

customerId,

page=1,

limit=10


}=req.query;




const filter =
scopeToRole(req);




if(type) filter.type=type;

if(status) filter.status=status;

if(customerId)
filter.customerId=customerId;




const logs =
await WhatsAppLog.find(filter)

.sort({

createdAt:-1

})

.skip((page-1)*limit)

.limit(limit);




const total =
await WhatsAppLog.countDocuments(filter);




res.json({



success:true,


count:logs.length,


total,


logs



});



});








// ----------------------------------------------------
// Webhook Verify
// ----------------------------------------------------


const verifyWebhook=(req,res)=>{


const mode=req.query["hub.mode"];

const token=req.query["hub.verify_token"];

const challenge=req.query["hub.challenge"];




if(

mode==="subscribe" &&

token===process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN

){


return res.status(200).send(challenge);


}



res.sendStatus(403);



};









// ----------------------------------------------------
// Receive Meta Updates
// ----------------------------------------------------



const receiveWebhook =
asyncHandler(async(req,res)=>{



const statusUpdate =

req.body?.entry?.[0]

?.changes?.[0]

?.value

?.statuses?.[0];





if(statusUpdate){



await WhatsAppLog.findOneAndUpdate(



{
providerMessageId:
statusUpdate.id
},



{
status:
statusUpdate.status
}



);



}




res.sendStatus(200);



});







module.exports={


sendMessage,


sendTemplate,


sendFollowUpReminder,


getLogs,


verifyWebhook,


receiveWebhook


};