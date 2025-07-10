

$.ajax({
    url: 'index.php?route=journal3/price&popup=' + (Journal['isPopup'] ? 1 : 0),
    type: 'post',
    data: $('#product-id, #product-quantity, #product input[type="radio"]:checked, #product input[type="checkbox"]:checked, #product select'),
    dataType: 'json',
    success: function (json) {
      console.log(json);
    },
    error: function (xhr, status, error) {
      console.error('Request failed:', status, error);
    }
  });
  
  