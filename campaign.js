const oldZips = []
//const oldZips = [] 

const masterCampaignId = "21075857699";
const masterCampaignName = `Campaign:Master`;
let geoData = {};
let masterCampaignDetails 
let allUploadData = []
let pausedCampaigns = [] 
let enabledCampaigns = []
var notificationObj = []


var recipents = ['emresalum1993@gmail.com','emre@pemavor.com','stefan@pemavor.com','albert.vu@123-transporter.cz', 'mathias.hoeninger@123-transporter.at', 'andreas.bonacina@123-transporter.at']
//var recipents = ['emresalum1993@gmail.com']



var uploadObj = AdWordsApp.bulkUploads().newCsvUpload(
  [
  
    "Row Type",
    "Action",
    "Customer ID",
    "Keyword",
    "Negative keyword",
    "Type",
    "Campaign",
    "Ad group",
    "Status",
    "Ad group type",
    "Label",
    "Campaign status",
    "Location",
    "Campaign start date",
    "Budget",
    "Budget type",
    "Target ROAS",
    "Networks",
    "Campaign type",
    "Campaign subtype",
    "Bid Strategy Type",
    "Language",
   
  ],
  { useLegacyUploads: true }
);

var keywordList = []

var adGroupUploadObj = AdWordsApp.bulkUploads().newCsvUpload([
  "Row Type",
  "Action",
  "Customer ID",
  "Campaign",
  "Ad group",
  "Label",
  "Status",
  "Type",
  "Default max. CPC",
  "Keyword",
  "Negative keyword",
"Campaign status",
  "Mobile final URL",
  "Final URL suffix",
  "Tracking template",
  "Ad status",
  "Headline 1",
  "Headline 2",
  "Headline 3",
  "Headline 4",
  "Headline 5",
  "Headline 6",
  "Headline 7",
  "Headline 8",
  "Headline 9",
  "Headline 10",
  "Headline 11",
  "Headline 12",
  "Headline 13",
  "Headline 14",
  "Headline 15",
  "Description 1",
  "Description 2",
  "Description 3",
  "Description 4",
  'Headline 1 position',
  'Headline 2 position',
  'Headline 3 position',
  'Headline 4 position',
  'Headline 5 position',
  'Headline 6 position',
  'Headline 7 position',
  'Headline 8 position',
  'Headline 9 position',
  'Headline 10 position',
  'Headline 11 position',
  'Headline 12 position',
  'Headline 13 position',
  'Headline 14 position',
  'Headline 15 position',

  "Ad type",
  "Final URL",
  "Path 1",
  "Path 2",

  'Ad group type',
]);

partnerBatchDetails = null
function main() {


partnerBatchDetails = queryPartnerBatch()
//////console.log(JSON.stringify(queryPartnerBatch()))

// Add them to a list for the executeInParallel later


masterCampaignDetails = getCampaignDetails(
  masterCampaignId,
  masterCampaignName
);

 
    processAccount()
  
 
  

  finalize()



 



 
  
}
function processAccount(){


  ////////console.log(`Master campaign is ready to use with name and id : ${masterCampaignName} - ${masterCampaignId}`);

  var campaignSelector = AdsApp.campaigns() 
  	.withCondition("campaign.name REGEXP_MATCH '.*Transporter_c:CZ_zip.*'")
    //.withCondition(`campaign.name = 'Transporter_c:AT_zip:4300_'`);

  var campaignIterator = campaignSelector.get();
  let childCampaigs = {};
  while (campaignIterator.hasNext()) {
    var campaign = campaignIterator.next();

       const campaignResult = AdsApp.mutate({
    campaignOperation: {
        update: {
            resourceName: campaign.getResourceName(),
            geoTargetTypeSetting: {positiveGeoTargetType: 'PRESENCE'}
         
        },
        updateMask: "geoTargetTypeSetting.positiveGeoTargetType"
    }
});
    
    
    
    childCampaigs[campaign.getId()] = getCampaignDetails(
      campaign.getId(),
      campaign.getName()
    );
  }
  manageCampaigns()
 
  let uploadReturn = fillCampaigns(masterCampaignDetails, childCampaigs);

  
  allUploadData = allUploadData.concat(uploadReturn)
  
}

function manageCampaigns(){

    let campaigns = {}
    let search = AdsApp.search(
        `SELECT campaign.name, campaign.id, campaign.status FROM campaign WHERE campaign.name REGEXP_MATCH '.*Transporter_c:CZ_zip.*' AND campaign.status != 'REMOVED'`
      ); 
    
      while (search.hasNext()) {
        let row = search.next();
        //console.log(row)
      campaigns[row.campaign.name] = row.campaign
      }


    //console.log(JSON.stringify(geoData))
    //console.log(JSON.stringify(campaigns))

    for (let campaign in campaigns){
        const zipCode = campaign.split('zip:')[1].replace('_', '')

        if (geoData['CZ'][zipCode]){
           
            if (campaigns[campaign].status == 'PAUSED'){

                if (zipCode == '25001' || zipCode == '29301' || zipCode=='35003' || zipCode == '43000' || zipCode == '47001' || zipCode == '73564' || zipCode == '79607' ){

                }
                else{
                    allUploadData.push(
                        {
                             "Row Type": "Campaign",
                             "Action": "Edit",
                             "Customer ID":       AdsApp.currentAccount().getCustomerId(),
                             "Campaign": campaign,
                             "Campaign status" : "enabled"
                         }
                        
                     ) 
                }
         
               enabledCampaigns.push({
                 customerId : AdsApp.currentAccount().getCustomerId(),
                 customerName : AdsApp.currentAccount().getName(),
                 zipCode : zipCode.toString(),
                 campaignName : campaign


               })
              }
        }
        else{
          
            if (campaigns[campaign].status !== 'PAUSED'){
                allUploadData.push(
                  {
                       "Row Type": "Campaign",
                       "Action": "Edit",
                       "Customer ID":       AdsApp.currentAccount().getCustomerId(),
                       "Campaign":  campaign,
                       "Campaign status" : "enabled"
                   }
                  
               ) 
               pausedCampaigns.push({
                 customerId : AdsApp.currentAccount().getCustomerId(),
                 customerName : AdsApp.currentAccount().getName(),
                 zipCode : zipCode.toString(),
                 campaignName : campaign


               })
              }
        }
    }
}
function finalize(){

  

allUploadData.forEach((f) => {
    adGroupUploadObj.append(f);
  });
  
  
  //console.log(JSON.stringify(allUploadData))
    var htmlBody = ''

     htmlBody += `${notificationObj.length} new campaigns for CZ Market (724-160-0591). Below you can see details: <br><br>`
    notificationObj.forEach((item,i)=>{
    
      
       //account : 'CZ (724-160-0591)', 
           // campaignName : singleCampaign.campaignName,
          //  zipCode : zipCode, 
           //   place : geoData[locationCode][zipCode.toString()].place
      
     htmlBody += `<br>(${i+1}) <b>Campaign Name</b> : ${item.campaignName}, <b>Zip Code</b> : ${item.zipCode}, <b>Location</b> : ${item.place}, <br>
     
     `
    
    })
  
if (notificationObj.length > 0){
  MailApp.sendEmail({
    to: recipents.join(','),
    subject: `${notificationObj.length} new campaigns for CZ Market (724-160-0591)`,
    htmlBody: htmlBody,
   
  }); 
}
  
 
  if (pausedCampaigns.length > 0 ){
  
    let pausedHTML = `Campaigns for transporters that have downtimes or that are long term booked by b2b clients are paused: <br>`
    pausedCampaigns.forEach(x=>{
      pausedHTML = pausedHTML + `<br><b>Zipcode: </b>${x.zipCode}, <b>Campaign: </b>${x.campaignName}`
    })
    
  
   // MailApp.sendEmail({
   //   to: recipents.join(','),
   //   subject: `${pausedCampaigns.length} campaigns paused for CZ Market`,
   //   htmlBody: pausedHTML,
   //  
  //  });
  }
    
  if (enabledCampaigns.length > 0){
  
    let pausedHTML = `Campaigns below enabled again: <br> `
    enabledCampaigns.forEach(x=>{
      pausedHTML = pausedHTML + `<br><b>Zipcode: </b>${x.zipCode}, <b>Campaign: </b>${x.campaignName}`
    })
    
  
  // MailApp.sendEmail({
    //  to: recipents.join(','),
     // subject: `${enabledCampaigns.length} campaigns enabled again for CZ Market`,
     // htmlBody: pausedHTML,
     
   // });
  }
 

  adGroupUploadObj.apply();
}
function fillCampaigns(master, childs) {
 
  let uploadObj = []
  for (let campaignId in childs) {
    let singleCampaign = childs[campaignId];   
     const campaignName = singleCampaign.campaignName;
     console.log(campaignName)
      const zipCode = campaignName.split("_zip:")[1].replace("_", "").replace(' ', '');
       
 
        if (master.adGroups){
            for (let adGroupdId in master.adGroups) {
              const singleMasterAdGroup = master.adGroups[adGroupdId];
        
          
              const cat =
                singleMasterAdGroup.originalName.split(":")[
                  singleMasterAdGroup.originalName.split(":").length - 1
                ];
       const locationCode = campaignName
                .split("Transporter_c:")[1]
                .split(`_`)[0];
  
                if ( geoData[locationCode][zipCode.toString()]){

                }
                else{
                  break
                }
              const newAdGroupName = `cat:${cat}_c:${locationCode}_zip:${zipCode}_`;
           
         
              let existingAdGroupNames = [];
              for (let id in singleCampaign.adGroups) {
                existingAdGroupNames.push(singleCampaign.adGroups[id].originalName);
              }
              let foundAdGroupId 
              Object.keys(singleCampaign.adGroups).forEach(ad=> {
                if (singleCampaign.adGroups[ad].originalName === newAdGroupName){
                  foundAdGroupId = ad
                }
             })
              if (existingAdGroupNames.indexOf(newAdGroupName) >= 0) {
                //////////console.log(`   (A) ${newAdGroupName} already exists in ${singleCampaign.campaignName}`)
              
                if (singleCampaign.adGroups[foundAdGroupId].status !== singleMasterAdGroup.status){
                    //////////console.log(`   (A) ${newAdGroupName} need to change status to ${singleMasterAdGroup.status}`)
              
                }
              } else {
              
                uploadObj = uploadObj.concat(createAdGroups(singleCampaign.campaignName, newAdGroupName, singleMasterAdGroup.targetCpa, singleMasterAdGroup.type))

                if (newAdGroupName.indexOf('cat:Location_c:CZ_zip:') >= 0){
                  uploadObj = uploadObj.concat(createAdGroups(singleCampaign.campaignName.split(':')[0] + ':CZ_all-cities_', newAdGroupName, singleMasterAdGroup.targetCpa, singleMasterAdGroup.type))
           
                }
                
                if (notificationObj.find(f=>f.campaignName == campaignName))
                {
                
                }      
                else{
                         notificationObj.push(
                  {
                  account : 'CZ (724-160-0591)', 
                  campaignName : singleCampaign.campaignName,
                  zipCode : zipCode, 
                    place : geoData[locationCode][zipCode.toString()].place
      
                  }
                )
                }
       
               
                
              }
        
              if (
                singleMasterAdGroup.keywords &&
                singleMasterAdGroup.keywords.length > 0
              ) {
                singleMasterAdGroup.keywords.forEach((keyword) => {
        
                //let cityName =  getLocationDetails(geoData[locationCode][zipCode])
                 
                let cityName =  geoData[locationCode][zipCode.toString()].place
              
                let oldCityName = geoData[locationCode][zipCode.toString()].place
                if (cityName.indexOf(',') >= 0){
                    cityName = cityName.split(',')[0].trim().toLowerCase()
                }
           
                if (cityName.indexOf('/') >= 0){
                    cityName = cityName.split('/')[0].trim().toLowerCase()
                }
               
                  let newTerm = keyword.term;
                  let oldTerm = keyword.term
                  newTerm = newTerm.replace(
                    `_LOCATION_`,
                   cityName
                  );
                  newTerm = newTerm.replace(
                    `$location$`,
                    cityName
                  );
                  newTerm = newTerm.trim().toLowerCase()
                  if (oldTerm !== newTerm){
                    if (keywordList.filter(z=> z.campaignName === campaignName).length ==0)
                    keywordList.push(
                        {
                            'campaignName': campaignName,
                            'added term' : newTerm,
                            'place in bigquery' : oldCityName
                        }
                    )
                  }
                  let foundKey 
                 
        
                  if (foundAdGroupId){
        
                  foundKey = singleCampaign.adGroups[foundAdGroupId].keywords && singleCampaign.adGroups[foundAdGroupId].keywords.length >= 0 ? singleCampaign.adGroups[foundAdGroupId].keywords.find(key=>key.term === newTerm) : null
        
                  }
                 
 
                  
                  ////console.log(zipCode.toString() + '...')
              
                    if (singleCampaign.adGroups[foundAdGroupId] && singleCampaign.adGroups[foundAdGroupId].keywords.find(k=>k.term == newTerm && k.matchType == keyword.matchType)){

                    }
                    else{
                      uploadObj = uploadObj.concat(createKeywords(singleCampaign.campaignName, newAdGroupName, keyword, newTerm))
                      if (newAdGroupName.indexOf('cat:Location_c:CZ_zip:') >= 0){
                        uploadObj = uploadObj.concat(createKeywords(singleCampaign.campaignName.split(':')[0] + ':CZ_all-cities_', newAdGroupName, keyword, newTerm))
           
                   
                      }
                    }
               
                });
              }
              ////////console.log('here $$$$')
              ////////console.log(JSON.stringify(singleMasterAdGroup))
              if (singleMasterAdGroup.ads && singleMasterAdGroup.ads.length > 0) {
                singleMasterAdGroup.ads.forEach((ad) => {
                  let cityName =  geoData[locationCode][zipCode].place
              
                 // let landing =  geoData[locationCode][zipCode].landing_page_urls
                 let landing = `123-transporter.cz/?m_zoom=11&m_lat=${ geoData[locationCode][zipCode].lat}&m_lng=${geoData[locationCode][zipCode].lng}`
                 ////console.log(landing)
                  let oldCityName = geoData[locationCode][zipCode].place
                  if (cityName.indexOf(',') >= 0){
                      cityName = cityName.split(',')[0].trim().toLowerCase()
                  }
             
                  if (cityName.indexOf('/') >= 0){
                      cityName = cityName.split('/')[0].trim().toLowerCase()
                  }

      if (oldZips.indexOf(zipCode) >= 0 ) {
        
      
      }
      else{

      
        const addToAdd = createAds(singleCampaign, newAdGroupName, ad, cityName,landing)
        uploadObj = uploadObj.concat(addToAdd)

        if (newAdGroupName.indexOf('cat:Location_c:CZ_zip:') >= 0){
        
          console.log(newAdGroupName)
          console.log(addToAdd)
          if (addToAdd && JSON.stringify(addToAdd) !== '{}'){
            console.log('here')
          const clone = createAdsCopy(singleCampaign, newAdGroupName, ad, cityName,landing)
          console.log(clone)
          uploadObj = uploadObj.concat(clone)

          }
        }

  


      }
               
                });
              }
             
            }
          }
      
          let foundObj = partnerBatchDetails[zipCode]
          if (foundObj){
           
               
              foundObj.partners.forEach(partner => {
              
                  if (!AdWordsApp.labels().withCondition("label.name = 'partner:" +  partner + "'").get().hasNext()) {
                      AdsApp.createLabel( "partner:" +  partner )
                  }
                  const campaign = AdsApp.campaigns()
                  .withCondition('campaign.name = "'+ singleCampaign.campaignName +'"').get().next();
              //campaign.applyLabel( "partner:" +  partner );
              
      
       
      /*    uploadObj = uploadObj.concat(
              {
                  "Row Type": "Campaign",
                  "Action": "Edit",
                  "Customer ID":       AdsApp.currentAccount().getCustomerId(),
                  "Campaign":  singleCampaign.campaignName,
                  "Label" : "'partner:" +  partner + "'"
              }
          ) */
      
       
      
       
              })
              
              foundObj.batchs.forEach(batch => {
              
                  if (!AdWordsApp.labels().withCondition("label.name = 'batch:" +  batch + "'").get().hasNext()) {
                      AdsApp.createLabel( "batch:" +  batch )
                  }
                  const campaign = AdsApp.campaigns()
                  .withCondition('campaign.name = "'+ singleCampaign.campaignName +'"').get().next();
              //campaign.applyLabel( "batch:" +  batch );
              
      
       
      /*    uploadObj = uploadObj.concat(
              {
                  "Row Type": "Campaign",
                  "Action": "Edit",
                  "Customer ID":       AdsApp.currentAccount().getCustomerId(),
                  "Campaign":  singleCampaign.campaignName,
                  "Label" : "'partner:" +  partner + "'"
              }
          ) */
      
       
      
       
              })
              
      
          }
     
    //////////console.log(`(C) Generating keywords and adgroups for the campaign ${singleCampaign.campaignName} -----------------`)
    ////////console.log(`here 2 `)
    ////////console.log(JSON.stringify(master.adGroups))
   
  }

  return uploadObj
  
   
}
function getLocationDetails(location){
    //https://maps.googleapis.com/maps/api/geocode/json?latlng=48.2167,16.4&key=AIzaSyCtAsohC3ZK4oU7c7kZKps-sK_T90LCBxs


}
function createAds(campaign, adGroupName, ad, cityName, landing) {

  //////console.log(adGroupName)
  //////////console.log(cityName)
 

  let willCreateAd = getAdObj(campaign, adGroupName, ad, cityName, landing)
  let group = []
 
 


  Object.keys(campaign.adGroups).forEach(sad=>{
   
  if (campaign.adGroups[sad].ads && campaign.adGroups[sad].ads.length > 0 ){
    campaign.adGroups[sad].ads.forEach(cad=>{
     
      let existingAd = getAdObj(campaign, sad.originalName, cad, cityName)
     
    group.push(existingAd)


    })
  }
  
  })



  let found = group.find(f=>f.Key === willCreateAd.Key)

 
  ////////console.log(`will log groupssss now `)
  
  ////////console.log(JSON.stringify(group))

  ////////console.log(`will log single now `)

  ////////console.log(found)
  ////////console.log(JSON.stringify(willCreateAd))
  if (found){
    //////console.log(found)
       return {}
  }
  else{
   // if (willCreateAd.Key.toLowerCase().indexOf('generic') >= 0){
     //   return {}
   // }
    //else{
      
   // }

   console.log(willCreateAd)
   return willCreateAd
  }


}
function createAdsCopy(campaign, adGroupName, ad, cityName, landing) {

  //////console.log(adGroupName)
  //////////console.log(cityName)
 

  let willCreateAd = getAdObj2(campaign, adGroupName, ad, cityName, landing)
  let group = []
 
 


  Object.keys(campaign.adGroups).forEach(sad=>{
   
  if (campaign.adGroups[sad].ads && campaign.adGroups[sad].ads.length > 0 ){
    campaign.adGroups[sad].ads.forEach(cad=>{
     
      let existingAd = getAdObj2(campaign, sad.originalName, cad, cityName)
     
    group.push(existingAd)


    })
  }
  
  })



  let found = group.find(f=>f.Key === willCreateAd.Key)

  return willCreateAd
  ////////console.log(`will log groupssss now `)
  
  ////////console.log(JSON.stringify(group))

  ////////console.log(`will log single now `)

  ////////console.log(found)
  ////////console.log(JSON.stringify(willCreateAd))
  if (found){
    //////console.log(found)
       return {}
  }
  else{
   // if (willCreateAd.Key.toLowerCase().indexOf('generic') >= 0){
     //   return {}
   // }
    //else{
      
   // }

   console.log(willCreateAd)
  
  }


}
function getAdObj(campaign,adGroupName,ad,cityName,landing){
  let adObj = {
    "Row Type": "Ad",
    "Action": "add",
    "Customer ID":       AdsApp.currentAccount().getCustomerId(),
    "Campaign":  campaign.campaignName,
    "Ad group": adGroupName,
    "Ad status": 'ENABLED',
    Label: `PEMAVOR-CREATED_BY_AUTOMATION [${AdsApp.currentAccount().getCustomerId()}]`,

    "Ad type": "Responsive search ad",

    "Headline 1": ad.adGroupAd.ad.responsiveSearchAd.headlines[0]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[0].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Headline 2": ad.adGroupAd.ad.responsiveSearchAd.headlines[1]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[1].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Headline 3": ad.adGroupAd.ad.responsiveSearchAd.headlines[2]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[2].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Headline 4": ad.adGroupAd.ad.responsiveSearchAd.headlines[3]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[3].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Headline 5": ad.adGroupAd.ad.responsiveSearchAd.headlines[4]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[4].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Headline 6": ad.adGroupAd.ad.responsiveSearchAd.headlines[5]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[5].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Headline 7": ad.adGroupAd.ad.responsiveSearchAd.headlines[6]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[6].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Headline 8": ad.adGroupAd.ad.responsiveSearchAd.headlines[7]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[7].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Headline 9": ad.adGroupAd.ad.responsiveSearchAd.headlines[8]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[8].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Headline 10": ad.adGroupAd.ad.responsiveSearchAd.headlines[9]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[9].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Headline 11": ad.adGroupAd.ad.responsiveSearchAd.headlines[10]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[10].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Headline 12": ad.adGroupAd.ad.responsiveSearchAd.headlines[11]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[11].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Headline 13": ad.adGroupAd.ad.responsiveSearchAd.headlines[12]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[12].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Headline 14": ad.adGroupAd.ad.responsiveSearchAd.headlines[13]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[13].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Headline 15": ad.adGroupAd.ad.responsiveSearchAd.headlines[14]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[14].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Description 1": ad.adGroupAd.ad.responsiveSearchAd.descriptions[0]
      ? ad.adGroupAd.ad.responsiveSearchAd.descriptions[0].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Description 2": ad.adGroupAd.ad.responsiveSearchAd.descriptions[1]
      ? ad.adGroupAd.ad.responsiveSearchAd.descriptions[1].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Description 3": ad.adGroupAd.ad.responsiveSearchAd.descriptions[2]
      ? ad.adGroupAd.ad.responsiveSearchAd.descriptions[2].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Description 4": ad.adGroupAd.ad.responsiveSearchAd.descriptions[3]
      ? ad.adGroupAd.ad.responsiveSearchAd.descriptions[3].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName)
      : "",
    "Final URL": 'https://' + landing,
    "Mobile final URL": ad.adGroupAd.ad.finalMobileUrls
      ? ad.adGroupAd.ad.finalMobileUrls[0]
      : "",
    "Final URL suffix": ad.adGroupAd.ad.finalUrlSuffix,
    "Tracking template": ad.adGroupAd.ad.trackingUrlTemplate,
    "Path 1": ad.adGroupAd.ad.responsiveSearchAd.path1,
    "Path 2": ad.adGroupAd.ad.responsiveSearchAd.path2,
    "Key" : `key::`
  };


  for (var xx = 1; xx <=15; xx++) {
    if (ad.adGroupAd.ad.responsiveSearchAd.headlines[xx - 1] && ad.adGroupAd.ad.responsiveSearchAd.headlines[xx - 1].pinnedField){
        adObj['Headline ' + xx + ' position'] =   ad.adGroupAd.ad.responsiveSearchAd.headlines[xx - 1].pinnedField.replace('HEADLINE_','')

    }
 
  }
  for (let adObjItem in adObj) {
    if (adObj[adObjItem] == "") {
      delete adObj[adObjItem];
    }
  }
 

  for (let x= 1; x <= 15; x++){
    if (adObj['Headline ' + x ] && adObj['Headline ' + x ].length > getLenNum(adObj['Headline ' + x ],30)){
      //////////console.log(JSON.stringify(adObj))
      //////////console.log('headline ' + x)

      ////////console.log('headline ' + x + 'too long  ' + adGroupName)
      ////////console.log(getLenNum(adObj['Headline ' + x ],30) + ' ' + adObj['Headline ' + x ].length)

      ////////console.log(  adObj['Headline ' + x ])

      var newstr=adObj['Headline ' + x ].replace(/\{(.+?)\}/g, ""+ 'In Deiner Umgebung'+"")
     
      
      adObj['Headline ' + x ] = newstr
      if (x == 4){
        adObj['Headline ' + x ] = 'In Deiner Umgebung'
      }
    
      ////////console.log(  adObj['Headline ' + x ])
    
    }
    adObj[`Key`] =  adObj[`Key`]  + adObj['Headline ' + x ] 
  }

  for (let x= 1; x <= 4; x++){
    if (adObj['Description ' + x ] && adObj['Description ' + x ].length > getLenNum(adObj['Description ' + x ],90)){
      ////////console.log('Description ' + x + 'too long' + adGroupName)
      ////////console.log(getLenNum(adObj['Description ' + x ],30) + ' ' +  adObj['Description ' + x ].length)
      adObj['Description ' + x ] = newstr
      var newstr=adObj['Description ' + x ].replace(/\{(.+?)\}/g, ""+ 'In Deiner Umgebung'+"")
 
 
      ////////console.log(adObj['Description ' + x ])

    }
    adObj[`Key`] =  adObj[`Key`]  + adObj['Description ' + x ] 
  }
   
 
  
  return adObj
}
function getAdObj2(campaign,adGroupName,ad,cityName,landing){
  let adObj = {
    "Row Type": "Ad",
    "Action": "add",
    "Customer ID":       AdsApp.currentAccount().getCustomerId(),
    "Campaign":  campaign.campaignName.split(':')[0] + ':CZ_all-cities_',
    "Ad group": adGroupName,
    "Ad status": 'ENABLED',
    Label: `PEMAVOR-CREATED_BY_AUTOMATION [${AdsApp.currentAccount().getCustomerId()}]`,

    "Ad type": "Responsive search ad",

    "Headline 1": ad.adGroupAd.ad.responsiveSearchAd.headlines[0]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[0].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Headline 2": ad.adGroupAd.ad.responsiveSearchAd.headlines[1]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[1].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Headline 3": ad.adGroupAd.ad.responsiveSearchAd.headlines[2]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[2].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Headline 4": ad.adGroupAd.ad.responsiveSearchAd.headlines[3]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[3].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Headline 5": ad.adGroupAd.ad.responsiveSearchAd.headlines[4]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[4].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Headline 6": ad.adGroupAd.ad.responsiveSearchAd.headlines[5]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[5].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Headline 7": ad.adGroupAd.ad.responsiveSearchAd.headlines[6]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[6].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Headline 8": ad.adGroupAd.ad.responsiveSearchAd.headlines[7]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[7].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Headline 9": ad.adGroupAd.ad.responsiveSearchAd.headlines[8]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[8].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Headline 10": ad.adGroupAd.ad.responsiveSearchAd.headlines[9]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[9].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Headline 11": ad.adGroupAd.ad.responsiveSearchAd.headlines[10]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[10].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Headline 12": ad.adGroupAd.ad.responsiveSearchAd.headlines[11]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[11].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Headline 13": ad.adGroupAd.ad.responsiveSearchAd.headlines[12]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[12].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Headline 14": ad.adGroupAd.ad.responsiveSearchAd.headlines[13]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[13].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Headline 15": ad.adGroupAd.ad.responsiveSearchAd.headlines[14]
      ? ad.adGroupAd.ad.responsiveSearchAd.headlines[14].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Description 1": ad.adGroupAd.ad.responsiveSearchAd.descriptions[0]
      ? ad.adGroupAd.ad.responsiveSearchAd.descriptions[0].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Description 2": ad.adGroupAd.ad.responsiveSearchAd.descriptions[1]
      ? ad.adGroupAd.ad.responsiveSearchAd.descriptions[1].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Description 3": ad.adGroupAd.ad.responsiveSearchAd.descriptions[2]
      ? ad.adGroupAd.ad.responsiveSearchAd.descriptions[2].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Description 4": ad.adGroupAd.ad.responsiveSearchAd.descriptions[3]
      ? ad.adGroupAd.ad.responsiveSearchAd.descriptions[3].text.replace(`_LOCATION_`, cityName).replace(`$location$`, cityName).replace('LOCATION(City):','KeyWord:Transporter ')
      : "",
    "Final URL": 'https://' + landing,
    "Mobile final URL": ad.adGroupAd.ad.finalMobileUrls
      ? ad.adGroupAd.ad.finalMobileUrls[0]
      : "",
    "Final URL suffix": ad.adGroupAd.ad.finalUrlSuffix,
    "Tracking template": ad.adGroupAd.ad.trackingUrlTemplate,
    "Path 1": ad.adGroupAd.ad.responsiveSearchAd.path1,
    "Path 2": ad.adGroupAd.ad.responsiveSearchAd.path2,
    "Key" : `key::`
  };


  for (var xx = 1; xx <=15; xx++) {
    if (ad.adGroupAd.ad.responsiveSearchAd.headlines[xx - 1] && ad.adGroupAd.ad.responsiveSearchAd.headlines[xx - 1].pinnedField){
        adObj['Headline ' + xx + ' position'] =   ad.adGroupAd.ad.responsiveSearchAd.headlines[xx - 1].pinnedField.replace('HEADLINE_','')

    }
 
  }
  for (let adObjItem in adObj) {
    if (adObj[adObjItem] == "") {
      delete adObj[adObjItem];
    }
  }
 

  for (let x= 1; x <= 15; x++){
    if (adObj['Headline ' + x ] && adObj['Headline ' + x ].length > getLenNum(adObj['Headline ' + x ],30)){
      //////////console.log(JSON.stringify(adObj))
      //////////console.log('headline ' + x)

      ////////console.log('headline ' + x + 'too long  ' + adGroupName)
      ////////console.log(getLenNum(adObj['Headline ' + x ],30) + ' ' + adObj['Headline ' + x ].length)

      ////////console.log(  adObj['Headline ' + x ])

      var newstr=adObj['Headline ' + x ].replace(/\{(.+?)\}/g, ""+ 'In Deiner Umgebung'+"")
     
      
      adObj['Headline ' + x ] = newstr
      if (x == 4){
        adObj['Headline ' + x ] = 'In Deiner Umgebung'
      }
    
      ////////console.log(  adObj['Headline ' + x ])
    
    }
    adObj[`Key`] =  adObj[`Key`]  + adObj['Headline ' + x ] 
  }

  for (let x= 1; x <= 4; x++){
    if (adObj['Description ' + x ] && adObj['Description ' + x ].length > getLenNum(adObj['Description ' + x ],90)){
      ////////console.log('Description ' + x + 'too long' + adGroupName)
      ////////console.log(getLenNum(adObj['Description ' + x ],30) + ' ' +  adObj['Description ' + x ].length)
      adObj['Description ' + x ] = newstr
      var newstr=adObj['Description ' + x ].replace(/\{(.+?)\}/g, ""+ 'In Deiner Umgebung'+"")
 
 
      ////////console.log(adObj['Description ' + x ])

    }
    adObj[`Key`] =  adObj[`Key`]  + adObj['Description ' + x ] 
  }
   
 
  
  return adObj
}
function getLenNum(str,len){
  if (str.indexOf('{LOCATION(City)') >= 0 ){
    return len + 17
  }
  else{
    return len 
  }
}
function createKeywords(campaign, adGroupName, keyword,newTerm) {
  const campaignName = campaign 
  //////////console.log(`     (K) ${newTerm} keyword will be added to ${campaign.campaignName} (${keyword.term})`)
  return {
    "Row Type": "Keyword",
    Action: "add",
    "Customer ID":       AdsApp.currentAccount().getCustomerId(),
      "Default max. CPC" : 50, 
    Campaign: `${campaignName}`,
    "Ad group": `${adGroupName}`,
    Status: `${keyword.status}`,
    Type: `${keyword.matchType}`,
    Keyword: !keyword.isNegative ? newTerm : "",
    "Negative keyword": keyword.isNegative ? newTerm : "",
    Label: `PEMAVOR-CREATED_BY_AUTOMATION [${AdsApp.currentAccount().getCustomerId()}]`,
  };

 
}
function createAdGroups(campaignName, adGroupName,cpa,type) {
//////////console.log(`   (A) ${adGroupName} adgroup will be added to ${campaignName}`)
 return {
    "Row Type": `Ad Group`,
    Action: `add`,
    "Customer ID":       AdsApp.currentAccount().getCustomerId(),
    Campaign: `${campaignName}`,
    "Ad group": `${adGroupName}`,
  
    Label: `PEMAVOR-CREATED_BY_AUTOMATION [${AdsApp.currentAccount().getCustomerId()}]`,
  } 
}
function getCampaignDetails(campaignId, campaignName) {
  // get keywords
  let campaign = {};
  campaign[`campaignId`] = campaignId;
  campaign[`campaignName`] = campaignName;

  if (campaignName.indexOf(`Transporter_c:`) >= 0) {
     

    const locationCode = campaignName.split("Transporter_c:")[1].split(`_`)[0];

    if (geoData[locationCode]) {
    } else {
      geoData[locationCode] = {};
      queryDataTable(locationCode);

      //////////console.log(`Geo data from bigquery for ${locationCode} is fetched and ready to use.`);
    }
  }

  let adGroups = {};
  let searchAg = AdsApp.search(
    "SELECT ad_group.name, ad_group.status, campaign.name,ad_group.id FROM ad_group WHERE campaign.id = " +
      campaignId  + " AND ad_group.status != 'REMOVED'"
  ); 

  while (searchAg.hasNext()) {
    let row = searchAg.next();
    let name = row.adGroup.name;

    let id = row.adGroup.id;
    adGroups[id] = {
      originalName: name,
      newName: name.split("-")[0].trim().toString(),
      keywords: [],
      targetCpa: '',
      type: 'Standard',
      status: row.adGroup.status,
    };
  }


  let search = AdsApp.search(
    "SELECT ad_group.target_cpa_micros, ad_group.type, ad_group.name, ad_group.status, campaign.name,ad_group.id, ad_group.name,ad_group_criterion.keyword.match_type, ad_group_criterion.negative, ad_group_criterion.keyword.text, ad_group_criterion.status FROM ad_group_criterion WHERE campaign.id = " +
      campaignId +
      " AND ad_group_criterion.type = 'KEYWORD'"  + " AND ad_group.status != 'REMOVED'"
  );

  while (search.hasNext()) {
    let row = search.next();
    let name = row.adGroup.name;

    //////////console.log(JSON.stringify(row))
    let id = row.adGroup.id;
    let term = {
      term: row.adGroupCriterion["keyword"]
        ? row.adGroupCriterion["keyword"]["text"]
        : null,
      status: row.adGroupCriterion.status,
      matchType: row.adGroupCriterion.keyword.matchType,
      adGroupId: row.adGroup.id,
      campaign: row.campaign.name,
      adgroup: row.adGroup.name,
      isNegative: row.adGroupCriterion.negative,
    };
    if (adGroups[id]) {
      adGroups[id].keywords.push(term);
    } else {
      adGroups[id] = {
        originalName: name,
        newName: name.split("-")[0].trim().toString(),
        keywords: [term],
        targetCpa: row.adGroup.targetCpaMicros,
        type: 'Standard',
        status: row.adGroup.status,
      };
    }
  }

  let whereKeys = Object.keys(adGroups).map((m) => Number(m));
  //whereKeys = [134943998294];

  if (whereKeys && whereKeys.length > 0) {
  } else {
    campaign[`adGroups`] = adGroups;
    return campaign;
  }

  let search2 = AdsApp.search(
    "SELECT ad_group.id, ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.ad.name,ad_group_ad.ad.final_url_suffix,ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.path1,ad_group_ad.ad.responsive_search_ad.path2, ad_group_ad.ad.responsive_search_ad.descriptions,ad_group_ad.ad.final_mobile_urls,ad_group_ad.ad.tracking_url_template, ad_group_ad.ad.display_url, ad_group_ad.ad.final_urls  FROM ad_group_ad WHERE ad_group.id IN (" +
      whereKeys.join(",") +
      ") AND ad_group_ad.status != 'REMOVED'"
  );

  while (search2.hasNext()) {
    let row = search2.next();

    ////console.log(JSON.stringify(row))
    if (adGroups[row.adGroup.id].ads) {
      adGroups[row.adGroup.id].ads.push(row);
    } else {
      adGroups[row.adGroup.id].ads = [row];
    }
  }

  campaign[`adGroups`] = adGroups;

  ////console.log(JSON.stringify(campaign))
  return campaign;
}

function queryDataTable(locationCode) {
  // Replace this value with the project ID listed in the Google
  // Cloud Platform project.
  var projectId = "transporter-397408";

  var dataSetId = "GeoNames";
  var tableId = locationCode.toUpperCase();

  var fullTableName = 'transporter-397408.Transporters_DB.V_transporter_inventory_sync'

  var queryRequest = BigQuery.newQueryRequest();
  ////console.log(fullTableName)
  queryRequest.query =`
  #standardSQL
  SELECT postcode, lat, lng, city, landing_page_urls 
  FROM \`transporter-397408.Transporters_DB.V_transporter_inventory_sync\`;
`
   
    //console.log(queryRequest.query)
  var query = BigQuery.Jobs.query(queryRequest, projectId);

  var rows = [];
  if (query.jobComplete) {
    for (var i = 0; i < query.rows.length; i++) {
      var row = query.rows[i];

      geoData[locationCode][row.f[0].v.replaceAll(' ','')] = {lat : row.f[1].v, lng: row.f[2].v, place:row.f[3].v, landing_page_urls:row.f[4].v };
    }
  }
  
  //console.log(geoData)
}
 //transporter-397408.GeoNames.CZ
    function queryPartnerBatch() {
        // Replace this value with the project ID listed in the Google
        // Cloud Platform project.

        var obj = {}
        var projectId = "transporter-397408";
      
        var dataSetId = "Transporters_DB";
        var tableId = 'transporter_inventory'
      
        var fullTableName = projectId + ":" + dataSetId + "." + tableId;
      
        var queryRequest = BigQuery.newQueryRequest();
        queryRequest.query = `
        #standardSQL
        SELECT batch_name, partner_name, postcode 
        FROM \`transporter-397408.Transporters_DB.V_transporter_inventory_sync\` 
        GROUP BY batch_name, partner_name, postcode 
        ORDER BY postcode;
      `
          //console.log(queryRequest.query)
        var query = BigQuery.Jobs.query(queryRequest, projectId);
      
        var rows = [];
        if (query.jobComplete) {
          for (var i = 0; i < query.rows.length; i++) {
            var row = query.rows[i];
           
            if (obj[row.f[2].v]){

                if (obj[row.f[2].v].batchs.indexOf(row.f[0].v) < 0){
                    obj[row.f[2].v].batchs.push(row.f[0].v)
                }
                if (obj[row.f[2].v].partners.indexOf(row.f[1].v) < 0){
                    obj[row.f[2].v].partners.push(row.f[1].v)
                }
            }
            else{
                obj[row.f[2].v] = {
                    batchs : [ row.f[0].v],
                    partners : [row.f[1].v]
                }

            }
            
             }
        }

        return obj
      }