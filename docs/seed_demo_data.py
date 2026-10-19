import requests
B="http://localhost:8770"; H={"X-Admin-PIN":"4321"}
people=[("Aarav Menon","Senior","Solo","Pachai Nirame","Alaipayuthey"),("Maya Nair","Junior","Solo","Kannalane","Bombay"),("Dev Pillai","Senior","Duet","Aaromale","Vinnaithaandi Varuvaayaa"),("Anika Varma","Junior","Solo","Chinna Chinna Aasai","Roja"),("Rohan Iyer","Senior","Solo","Nila Kaayum","Marupadiyum"),("Sana Thomas","Senior","Solo","Maruvaarthai","Enai Noki Paayum Thota"),("Kavya Kurian","Junior","Solo","Munbe Vaa","Sillunu Oru Kaadhal"),("Arjun Das","Senior","Solo","Ennavale","Kadhalan")]
items=requests.get(B+"/api/admin/food-items",headers=H).json()
for n,(name,age,typ,song,movie) in enumerate(people):
    perf={"performance_type":typ,"song_title":song,"movie_name":movie}
    if typ=="Duet": perf.update(partner_name="Neha Pillai",partner_phone="6105550142",partner_age_group="Senior")
    body={"performer_name":name,"contact_info":"6105550%03d"%(100+n),"age_group":age,"performances":[perf]}
    if age=="Junior": body.update(guardian_name="Parent of "+name.split()[0],guardian_phone="6105550199")
    if n%2==0: body["food_signup"]={"item_id":items[n]["item_id"],"dish_description":["Veg biryani","Paneer curry","Gulab jamun","Samosa chaat"][n//2%4]}
    requests.post(B+"/api/signup",json=body)
perfs=requests.get(B+"/api/stage-queue",headers=H).json()
print(requests.post(B+"/api/set-active/"+perfs[1]['entry_id'],headers=H).text)
